import { BadGatewayException, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

function parseSse(raw: string): { type: string; data: string } {
  let type = 'message';
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) type = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  return { type, data: dataLines.join('\n') }
}

/**
 * AI 服务 BFF：把请求代理到 FastAPI ai-service。
 * - jsonRequest: 非流式（outline / summarize）
 * - streamRequest: SSE 流式透传（chapter / continue / polish）
 *   返回 true=正常透传完成；false=已向前端发送 SSE error 事件。
 */
@Injectable()
export class AiService {
  private readonly baseUrl = process.env.AI_SERVICE_URL ?? 'http://localhost:8000';

  constructor(private readonly prisma: PrismaService) {}

  /** 非流式调用 + 记录 AiTask（含 token 用量 / 缓存命中）。 */
  async loggedJson(type: string, novelId: number | undefined, path: string, body: unknown): Promise<any> {
    try {
      const r = await this.jsonRequest(path, body);
      const u = r?.usage ?? {};
      this.recordTask({ type, novelId, status: 'success', tokensIn: u.in ?? 0, tokensOut: u.out ?? 0, cached: !!r?.cached, model: u.model ?? null });
      return r;
    } catch (e) {
      this.recordTask({ type, novelId, status: 'error', error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }

  /** 同 loggedJson，但失败不抛（用于 memory/consistency 等容错链路内部调用），仅记 error 任务。 */
  async loggedJsonSilent(type: string, novelId: number | undefined, path: string, body: unknown): Promise<any> {
    try {
      const r = await this.jsonRequest(path, body);
      const u = r?.usage ?? {};
      this.recordTask({ type, novelId, status: 'success', tokensIn: u.in ?? 0, tokensOut: u.out ?? 0, cached: !!r?.cached, model: u.model ?? null });
      return r;
    } catch (e) {
      this.recordTask({ type, novelId, status: 'error', error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }

  private recordTask(data: { type: string; novelId?: number; chapterId?: number; status: string; tokensIn?: number; tokensOut?: number; cached?: boolean; model?: string | null; error?: string }) {
    // best-effort，不抛
    this.prisma.aiTask
      .create({ data: {
        type: data.type,
        novelId: data.novelId,
        chapterId: data.chapterId,
        status: data.status,
        tokensIn: data.tokensIn ?? 0,
        tokensOut: data.tokensOut ?? 0,
        cached: data.cached ?? false,
        model: data.model ?? null,
        error: data.error ?? null,
      } })
      .catch(() => undefined);
  }

  /** GET 请求到 ai-service（配置读取等）。 */
  async getRequest(path: string): Promise<any> {
    const r = await fetch(`${this.baseUrl}${path}`);
    if (!r.ok) throw new BadGatewayException(`AI service ${r.status}`);
    return r.json();
  }

  async jsonRequest(path: string, body: unknown): Promise<any> {
    let r: Awaited<ReturnType<typeof fetch>>;
    try {
      r = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new BadGatewayException(`无法连接 AI 服务（${this.baseUrl}），请确认 ai-service 已启动`);
    }
    const text = await r.text();
    if (!r.ok) {
      throw new BadGatewayException(`AI 服务返回 ${r.status}：${text.slice(0, 500)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  async streamRequest(path: string, body: unknown, res: Response): Promise<boolean> {
    const controller = new AbortController();
    res.on('close', () => controller.abort());

    let upstream: Awaited<ReturnType<typeof fetch>>;
    try {
      upstream = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      this.sendSseError(res, `无法连接 AI 服务（${this.baseUrl}），请确认 ai-service 已启动`);
      return false;
    }

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '');
      this.sendSseError(res, `AI 服务返回 ${upstream.status}：${text.slice(0, 500)}`);
      return false;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const reader = upstream.body.getReader();
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      return true;
    } catch {
      // 客户端断开或 abort —— 视为正常结束
      return true;
    } finally {
      res.end();
    }
  }

  private sendSseError(res: Response, message: string) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.flushHeaders?.();
    res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
    res.end();
  }

  /** 服务端消费 SSE 流，累积 token 成完整文本（批量生成正文用）。返回 { text, usage }。 */
  async collectStream(path: string, body: unknown): Promise<{ text: string; usage?: { in: number; out: number; model?: string | null } }> {
    let upstream: Awaited<ReturnType<typeof fetch>>;
    try {
      upstream = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new BadGatewayException(`无法连接 AI 服务（${this.baseUrl}）`);
    }
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '');
      throw new BadGatewayException(`AI 服务返回 ${upstream.status}：${text.slice(0, 500)}`);
    }
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let acc = '';
    let usage: { in: number; out: number; model?: string | null } | undefined;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const ev = parseSse(raw);
        if (ev.type === 'error') {
          throw new BadGatewayException(`生成失败：${ev.data.slice(0, 300)}`);
        }
        if (ev.data === '[DONE]') return { text: acc, usage };
        try {
          const j = JSON.parse(ev.data);
          if (j.token) acc += j.token;
          if (j.usage) usage = { in: j.usage.in ?? 0, out: j.usage.out ?? 0, model: j.usage.model ?? null };
        } catch {
          /* ignore */
        }
      }
    }
    return { text: acc, usage };
  }
}
