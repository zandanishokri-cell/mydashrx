import NextAuth, { type NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? 'dev-internal-secret';

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      try {
        const res = await fetch(`${API}/api/v1/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
          body: JSON.stringify({ email: user.email }),
        });
        if (!res.ok) return '/login?error=NoAccount';
        const data = await res.json();
        (user as any).accessToken = data.accessToken;
        (user as any).refreshToken = data.refreshToken;
        (user as any).myUser = data.user;
        return true;
      } catch {
        return '/login?error=ServerError';
      }
    },
    async jwt({ token, user }) {
      if (user) {
        token.accessToken = (user as any).accessToken;
        token.refreshToken = (user as any).refreshToken;
        token.myUser = (user as any).myUser;
      }
      return token;
    },
    async session({ session, token }) {
      (session as any).accessToken = token.accessToken;
      (session as any).refreshToken = token.refreshToken;
      (session as any).myUser = token.myUser;
      return session;
    },
  },
  pages: { signIn: '/login' },
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
