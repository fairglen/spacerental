import NextAuth from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import type { NextAuthOptions } from 'next-auth'

type SessionMembership = { org_id: string; role: 'owner' | 'admin' | 'member' }

// Server-side calls (this file runs in Next.js server/container, not the browser).
// INTERNAL_API_URL uses the Docker service name; falls back to localhost for local dev without Docker.
const API_URL = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

// Decodes the payload of a base64url-encoded JWT without verifying the signature.
// The FastAPI-issued JWT embeds `memberships` for the switcher; we only read it,
// the backend re-validates every request anyway.
function decodeJwtMemberships(token: string): SessionMembership[] {
  try {
    const payload = token.split('.')[1]
    if (!payload) return []
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const json = Buffer.from(normalized, 'base64').toString('utf-8')
    const claims = JSON.parse(json) as { memberships?: SessionMembership[] }
    return Array.isArray(claims.memberships) ? claims.memberships : []
  } catch {
    return []
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null
        try {
          const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: credentials.email, password: credentials.password }),
          })
          if (!res.ok) return null
          const data = await res.json()
          return {
            id: data.user.id,
            email: data.user.email,
            name: data.user.name,
            accessToken: data.access_token,
            role: data.role,
            memberships: decodeJwtMemberships(data.access_token),
          }
        } catch {
          return null
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.accessToken = user.accessToken
        token.role = user.role
        token.id = user.id
        token.memberships = user.memberships ?? []
      }
      return token
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken
      session.role = token.role
      session.user.id = token.id
      session.memberships = token.memberships ?? []
      return session
    },
  },
  pages: {
    signIn: '/sign-in',
    error: '/sign-in',
  },
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET || 'dev-nextauth-secret-change-in-production',
}

const handler = NextAuth(authOptions)
export { handler as GET, handler as POST }
