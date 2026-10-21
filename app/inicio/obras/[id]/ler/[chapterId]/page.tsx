import { WorkReader } from '@/components/work-reader'
export default async function LeituraObraPage({ params }: { params: Promise<{ id: string; chapterId: string }> }) {
  const { id, chapterId } = await params
  return <WorkReader workId={Number(id)} chapterId={Number(chapterId)} />
}
