import { SectionsController } from './sections.controller'
import { SectionsProcessingService } from './sections.processing.service'
import { SectionsRepository } from './sections.repository'
import { SectionsService } from './sections.service'
import { SectionsStatsService } from './sections.stats.service'

const sectionsRepository = new SectionsRepository()
const sectionsProcessingService = new SectionsProcessingService(sectionsRepository)
const sectionsService = new SectionsService(sectionsRepository, sectionsProcessingService)
export const sectionsController = new SectionsController(sectionsService)
export const sectionsStatsService = new SectionsStatsService(sectionsRepository)
