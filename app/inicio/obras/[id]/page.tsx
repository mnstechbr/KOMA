import { WorkDetail } from '@/components/work-detail'
export default async function ObraPage({ params }: { params: Promise<{ id: string }> }) { return <WorkDetail id={Number((await params).id)} /> }
