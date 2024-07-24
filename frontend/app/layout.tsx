import type { Metadata } from 'next'
import dynamic from 'next/dynamic';
import { Inter } from 'next/font/google'
import './globals.css' // Assuming you have global styles

const inter = Inter({ subsets: ['latin'] })

const ClientProviders = dynamic(() => import('@/components/ClientProviders'), { 
  ssr: false,
  loading: () => <div>Loading...</div>
})

export const metadata: Metadata = {
  title: 'Carnation Radio',
  description: 'Listen, bid, and mint NFTs of your favorite music sets',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  )
}