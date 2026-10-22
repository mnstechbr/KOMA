import { MobileReader } from '@/components/mobile-reader'
export default async function MovelLeituraPage({ params }: { params: Promise<{ id: string; chapterId: string }> }) {
  const { id, chapterId } = await params
  return <MobileReader workId={Number(id)} chapterId={Number(chapterId)} />
}
