import Link from 'next/link'
import { sourceConnectors } from '@/lib/backend/works/source-registry'
import { serverT } from '@/lib/i18n/server'

export default async function SourcesPage() {
  const t = await serverT()
  return (
    <div>
      <Link href="/inicio/secoes" className="koma-text-link koma-back">
        {t('← Biblioteca')}
      </Link>
      <header className="koma-page-head">
        <div>
          <h1>{t('Fontes de obras')}</h1>
          <p>
            {t(
              'O KOMA consulta os vínculos da publicação original e as fontes vinculadas à obra. A tabela distingue acompanhamento de catálogo e coleta de páginas. A disponibilidade de cada obra aparece nos detalhes depois de atualizar.',
            )}
          </p>
        </div>
      </header>
      <div className="koma-table-wrap">
        <table className="koma-table">
          <thead>
            <tr>
              <th>{t('Fonte')}</th>
              <th>{t('Origem')}</th>
              <th>{t('Índice de capítulos')}</th>
              <th>{t('Coleta de páginas')}</th>
            </tr>
          </thead>
          <tbody>
            {sourceConnectors.map((source) => (
              <tr key={source.id}>
                <td>
                  <strong>{source.name}</strong>
                  <p>{t(source.note)}</p>
                </td>
                <td>{t(source.country)}</td>
                <td className={source.index ? 'koma-yes' : 'koma-no'}>{source.index ? t('Implementado') : t('Pendente')}</td>
                <td className={source.pages ? 'koma-yes' : 'koma-no'}>{source.pages ? t('Episódios públicos') : t('Pendente')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="koma-prose mt-8">
        <p>
          {t(
            'A busca por títulos consulta o MangaDex e as fontes personalizadas, com a fonte identificada em cada resultado. Ao atualizar uma obra, o KOMA pesquisa o mesmo título no WEBTOON e nas fontes que você adicionou, une os capítulos por número e escolhe a versão de cada capítulo nesta ordem: publicação original, PT-BR, edição oficial traduzida, MangaDex e demais sites. Se uma fonte falhar ou o episódio for pago, tenta a próxima.',
          )}
        </p>
        <p>
          {t(
            'Você pode vincular o endereço da mesma obra numa fonte suportada dentro dos detalhes dela. Esse vínculo importa todos os capítulos encontrados, sem cadastro manual de cada capítulo.',
          )}
        </p>
      </div>
    </div>
  )
}
