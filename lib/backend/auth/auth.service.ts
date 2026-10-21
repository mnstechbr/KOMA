import type { LocalUser } from './auth.types'
import { AuthRepository } from './auth.repository'

export class AuthService {
  constructor(private readonly repository: AuthRepository) {}

  getUserFromToken(token: string | null | undefined): LocalUser | null {
    return this.repository.getUserFromToken(token)
  }
}
