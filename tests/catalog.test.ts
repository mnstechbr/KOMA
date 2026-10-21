import {describe,it,expect,vi} from 'vitest'
import {searchAllCatalogs,validateCatalogId} from '../lib/backend/works/catalog'
import type {CatalogWork} from '../lib/works'

const work = {source:'site',sourceId:'site:obra',title:'Obra'} as CatalogWork
describe('busca independente em mais de um catálogo',()=>{
  it('uma fonte com erro não esconde os resultados da outra',async()=>{
    const result=await searchAllCatalogs('obra',undefined,[{name:'Falhou',search:vi.fn().mockRejectedValue(new Error('offline'))},{name:'Respondeu',search:vi.fn().mockResolvedValue([work])}])
    expect(result.results).toHaveLength(1)
    expect(result.sources).toEqual([{name:'Falhou',available:false},{name:'Respondeu',available:true}])
  })
  it('distingue indisponibilidade total de busca sem correspondência',async()=>{
    await expect(searchAllCatalogs('obra',undefined,[{name:'offline',search:vi.fn().mockRejectedValue(new Error())}])).rejects.toThrow('Nenhuma fonte respondeu')
  })
  it('não aceita um identificador de catálogo com caminho ou host arbitrário',()=>{
    expect(validateCatalogId('site:obra')).toBe('site:obra')
    for(const value of ['site:../../secret','site:obra/extra','https://evil.invalid','site:'])expect(()=>validateCatalogId(value)).toThrow()
  })
})
