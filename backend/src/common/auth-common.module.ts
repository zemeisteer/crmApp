import { Global, Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';

// Global so JwtAuthGuard (AuthGuard('jwt')) can be used in any feature module
// without each of them having to import PassportModule individually.
@Global()
@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt', session: false })],
  providers: [JwtStrategy],
  exports: [PassportModule],
})
export class AuthCommonModule {}
