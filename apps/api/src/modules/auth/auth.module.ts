import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { TokenService } from "./token.service";
import { TwoFactorService } from "./two-factor.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, TokenService, TwoFactorService],
  exports: [AuthService, TokenService, TwoFactorService, JwtModule],
})
export class AuthModule {}
