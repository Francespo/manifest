import { Controller, Get, Query } from '@nestjs/common';
import { RangeQueryDto } from '../../common/dto/range-query.dto';
import { CallersQueryService } from '../services/callers-query.service';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth.instance';

@Controller('api/v1')
export class CallersController {
  constructor(private readonly callersQuery: CallersQueryService) {}

  @Get('callers')
  async getCallers(@Query() query: RangeQueryDto, @CurrentUser() user: AuthUser) {
    const range = query.range ?? '24h';
    return this.callersQuery.getCallers(range, user.id, query.agent_name);
  }
}
