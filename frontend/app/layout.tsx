import type { Metadata } from 'next'
import dynamic from 'next/dynamic';
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

const ClientProviders = dynamic(() => import('@/components/ClientProviders'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-surface flex items-center justify-center text-white">
      Loading...
    </div>
  ),
})

export const metadata: Metadata = {
  title: 'Carnation Radio',
  description: 'Hide encrypted messages in music. Decode them during playback.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" data-theme="carnation">
      <body className={`${inter.className} min-h-screen bg-surface`}>
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  )
}
