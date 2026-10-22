import { mergeCatalogs } from './core'
import { languageMessages } from './messages/language'
import { libraryMessages } from './messages/library'
import { pagesMessages } from './messages/pages'
import { performanceMessages } from './messages/performance'
import { preferencesMessages } from './messages/preferences'
import { shellMessages } from './messages/shell'
import { sourcesMessages } from './messages/sources'

// Novos arquivos de mensagens entram nesta lista.
export const catalog = mergeCatalogs(
  shellMessages,
  languageMessages,
  libraryMessages,
  pagesMessages,
  preferencesMessages,
  sourcesMessages,
  performanceMessages,
)
