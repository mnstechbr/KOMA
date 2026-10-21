import type { LocalUser } from './auth.types'
import { AuthService } from './auth.service'

export class AuthController {
  constructor(private readonly service: AuthService) {}

  getUserFromToken(token: string | null | undefined): LocalUser | null {
    return this.service.getUserFromToken(token)
  }
}
