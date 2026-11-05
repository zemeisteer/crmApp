import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';

// Where a password, code or link is being guessed: always counted by address,
// or an attacker with a few accounts would get a fresh allowance per token.
const GUESSABLE = /\/(auth\/(login|register|2fa\/verify-login|forgot-password|reset-password|handoff)|portal\/auth\/|invitations\/[^/]+\/accept|public\/)/;
const jwt = new JwtService();

/**
 * Counts a signed-in person's requests as theirs, not their address's: a
 * center's Wi-Fi or a carrier's shared address holds many people, and one
 * limit between them refused students in the middle of a lesson. A forged or
 * expired token is nobody, and is counted by address.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  @Inject(ConfigService) private readonly config!: ConfigService;

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const header: string | undefined = req.headers?.authorization;
    const secret = this.config.get<string>('JWT_SECRET');
    if (secret && header?.startsWith('Bearer ') && !GUESSABLE.test(req.path ?? req.url ?? '')) {
      try {
        const payload = jwt.verify<{ sub?: string; pending2fa?: boolean }>(header.slice(7).trim(), { secret });
        if (payload.sub && !payload.pending2fa) return `user:${payload.sub}`;
      } catch {
        // Counted by address.
      }
    }
    return super.getTracker(req);
  }
}
