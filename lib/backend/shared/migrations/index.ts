import { migration001InitialSchema } from './001_initial_schema'
import { migration002TranslationReports } from './002_translation_reports'
import { migration003TranslationReportImageCrop } from './003_translation_report_image_crop'
import { migration004TranslationReportCorrectedText } from './004_translation_report_corrected_text'
import { migration005Works } from './005_works'
import { migration006WorkRecovery } from './006_work_recovery'
import { migration007CatalogSources } from './007_catalog_sources'
import { migration008PreparationPipeline } from './008_preparation_pipeline'
import { migration009RetryRejectedPages } from './009_retry_rejected_pages'
import { migration010ReocrSplitBalloons } from './010_reocr_split_balloons'
import { migration011PartialPagesReadable } from './011_partial_pages_readable'
import { migration012MultiSource } from './012_multi_source'
import { migration013PageUpgrade } from './013_page_upgrade'
import { migration014Rerender } from './014_rerender'
import { migration015StuckPages } from './015_stuck_pages'
import { migration016RetranslateBlanks } from './016_retranslate_blanks'
import { migration017CloudStorage } from './017_cloud_storage'
import { migration018WorkTargetLanguage } from './018_work_target_language'
import { migration019UnofficialSources } from './019_unofficial_sources'
import { migration020PartialMessage } from './020_partial_message'
import { migration021RetryBlockedImages } from './021_retry_blocked_images'
import { migration022RenderingState } from './022_rendering_state'
import { migration023RenderStale } from './023_render_stale'
import { migration024SectionImagesIndex } from './024_section_images_index'
import { migration025StaleWithoutText } from './025_stale_without_text'
import { migration026UnreadableBalloons } from './026_unreadable_balloons'
import { migration027ChapterChoice } from './027_chapter_choice'

export interface SqliteMigration {
  version: number
  name: string
  up: string
}

export const SQLITE_MIGRATIONS: SqliteMigration[] = [
  migration001InitialSchema,
  migration002TranslationReports,
  migration003TranslationReportImageCrop,
  migration004TranslationReportCorrectedText,
  migration005Works,
  migration006WorkRecovery,
  migration007CatalogSources,
  migration008PreparationPipeline,
  migration009RetryRejectedPages,
  migration010ReocrSplitBalloons,
  migration011PartialPagesReadable,
  migration012MultiSource,
  migration013PageUpgrade,
  migration014Rerender,
  migration015StuckPages,
  migration016RetranslateBlanks,
  migration017CloudStorage,
  migration018WorkTargetLanguage,
  migration019UnofficialSources,
  migration020PartialMessage,
  migration021RetryBlockedImages,
  migration022RenderingState,
  migration023RenderStale,
  migration024SectionImagesIndex,
  migration025StaleWithoutText,
  migration026UnreadableBalloons,
  migration027ChapterChoice,
]
