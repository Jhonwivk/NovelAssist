import { Body, Controller, Get, Post } from '@nestjs/common';
import { AiService } from './ai.service';

/** API 配置读写（供主页配置面板）。 */
@Controller('config')
export class ConfigController {
  constructor(private readonly ai: AiService) {}

  @Get()
  get() {
    return this.ai.getRequest('/config');
  }

  @Post()
  set(@Body() body: {
    token?: string;
    base_url?: string;
    model?: string;
    provider?: string;
    deepseek_key?: string;
    deepseek_base_url?: string;
    openai_key?: string;
    openai_base_url?: string;
  }) {
    return this.ai.jsonRequest('/config', body);
  }
}
