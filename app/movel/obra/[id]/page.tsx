import { MobileWork } from '@/components/mobile-reader'
export default async function MovelObraPage({ params }: { params: Promise<{ id: string }> }) {
  return <MobileWork workId={Number((await params).id)} />
}
