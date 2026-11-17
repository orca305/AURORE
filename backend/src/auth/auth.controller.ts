import { Type } from 'class-transformer';
import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import {
  Equals,
  IsBoolean,
  IsString,
  MaxLength,
  IsOptional,
  IsIn,
  IsInt,
  Min,
  Max,
  Matches,
} from 'class-validator';
import { AuthService } from './auth.service.js';

class LoginDto {
  @IsString()
  @MaxLength(64)
  loginId!: string;

  @IsString()
  @MaxLength(64)
  password!: string;
}

class ChangePasswordDto {
  @IsString()
  @MaxLength(64)
  currentPassword!: string;

  @IsString()
  @MaxLength(64)
  newPassword!: string;
}

class ConsentHistoryDto {
  @IsOptional() @Type(() => Number) @IsIn([10, 20, 50]) limit = 20;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) offset = 0;
}
class ConsentDto {
  @IsBoolean() agreed!: boolean;
  @Matches(/^(0|[1-9]\d{0,18})$/) revision!: string;
  @IsBoolean() @Equals(true) confirmed!: boolean;
}
class WithdrawalDto {
  @IsString()
  @MaxLength(64)
  currentPassword!: string;

  @IsBoolean()
  @Equals(true)
  confirmed!: boolean;
}

class SignupDto extends LoginDto {
  @IsString()
  @MaxLength(64)
  nickname!: string;
}

function sessionToken(authorization?: string) {
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? '')?.[1];
  if (!token) throw new UnauthorizedException('로그인이 필요합니다.');
  return token;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('guest')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  guest() {
    return this.auth.createGuest();
  }

  @Post('signup')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async signup(@Body() body: SignupDto) {
    await this.auth.signup(body.loginId, body.nickname, body.password);
    return { registered: true };
  }

  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  login(@Body() body: LoginDto) {
    return this.auth.login(body.loginId, body.password);
  }

  @Get('session')
  @Header('Cache-Control', 'no-store')
  session(@Headers('authorization') authorization?: string) {
    return this.auth.session(sessionToken(authorization), false);
  }

  @Post('session/activity')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  activity(@Headers('authorization') authorization?: string) {
    return this.auth.session(sessionToken(authorization), true);
  }

  @Post('password')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async changePassword(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: ChangePasswordDto,
  ) {
    await this.auth.changePassword(
      sessionToken(authorization),
      body.currentPassword,
      body.newPassword,
    );
  }

  @Get('learning-consent')
  @Header('Cache-Control', 'no-store')
  learningConsent(
    @Headers('authorization') authorization: string | undefined,
    @Query() query: ConsentHistoryDto,
  ) {
    return this.auth.learningConsent(
      sessionToken(authorization),
      query.limit,
      query.offset,
    );
  }

  @Post('learning-consent')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  saveLearningConsent(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: ConsentDto,
  ) {
    return this.auth.setLearningConsent(
      sessionToken(authorization),
      body.agreed,
      body.revision,
    );
  }

  @Get('withdrawal')
  @Header('Cache-Control', 'no-store')
  withdrawalPreview(@Headers('authorization') authorization?: string) {
    return this.auth.withdrawalPreview(sessionToken(authorization));
  }

  @Post('withdrawal')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  withdraw(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: WithdrawalDto,
  ) {
    return this.auth.withdraw(
      sessionToken(authorization),
      body.currentPassword,
    );
  }

  @Post('logout-all')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async logoutAll(@Headers('authorization') authorization?: string) {
    await this.auth.logoutAll(sessionToken(authorization));
  }

  @Post('logout')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async logout(@Headers('authorization') authorization?: string) {
    await this.auth.logout(sessionToken(authorization));
  }
}
