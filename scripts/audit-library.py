#!/usr/bin/env python3
"""Auditoria somente leitura. Não chama fontes, OCR, LLM ou KPassword."""
import argparse, csv, datetime, hashlib, html, json, pathlib, sqlite3
from zoneinfo import ZoneInfo

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--database', required=True)
parser.add_argument('--baseline', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
output = pathlib.Path(args.output); output.mkdir(parents=True, exist_ok=True)
def connection(filename):
    database = sqlite3.connect(pathlib.Path(filename).resolve().as_uri() + '?mode=ro', uri=True)
    database.row_factory = sqlite3.Row
    database.execute('PRAGMA query_only=ON'); database.execute('BEGIN')
    return database
current = connection(args.database); baseline = connection(args.baseline)
works = [dict(row) for row in current.execute('SELECT id,title,source,source_id,stage,paused,last_synced_at FROM works ORDER BY id')]
chapters = [dict(row) for row in current.execute('SELECT id,work_id,number,volume,language,state,page_count,section_id,message,read_done FROM work_chapters ORDER BY work_id,position,id')]
old = {row['id']: dict(row) for row in baseline.execute('SELECT id,work_id,number,volume,language,state,page_count,section_id,read_done FROM work_chapters')}
pages = [dict(row) for row in current.execute('''SELECT p.id,p.chapter_id,p.page_index,p.state,p.message,p.recovery_attempted,p.image_id,i.original_path,
 (SELECT COUNT(*) FROM section_image_ocr_items o WHERE o.section_image_id=p.image_id AND length(o.translated_text)>0) AS translated_balloons
 FROM work_pages p LEFT JOIN section_images i ON i.id=p.image_id ORDER BY p.chapter_id,p.page_index''')]
by_chapter = {}
for page in pages: by_chapter.setdefault(page['chapter_id'], []).append(page)
for chapter in chapters:
    previous = old.get(chapter['id'])
    chapter['previous_state'] = previous['state'] if previous else 'not_in_baseline'
    chapter['was_error'] = bool(previous and previous['state']=='error')
    chapter['error_now_ready'] = chapter['was_error'] and chapter['state']=='ready'
    chapter_pages = by_chapter.get(chapter['id'], [])
    chapter['pages_recorded'] = len(chapter_pages)
    chapter['pages_ready'] = sum(p['state']=='ready' for p in chapter_pages)
    chapter['pages_review'] = sum(p['state']=='review' for p in chapter_pages)
    chapter['translated_balloons'] = sum(p['translated_balloons'] for p in chapter_pages)
    chapter['missing_original_files'] = sum(not p['original_path'] or not pathlib.Path(p['original_path']).is_file() for p in chapter_pages)
    chapter['ready_integrity'] = chapter['state'] != 'ready' or bool(chapter_pages and len(chapter_pages)==chapter['page_count'] and chapter['pages_ready']==chapter['page_count'] and chapter['missing_original_files']==0)
    chapter['preserved_previously_ready'] = not previous or previous['state']!='ready' or (chapter['state']=='ready' and chapter['section_id']==previous['section_id'] and chapter['read_done']==previous['read_done'])
    chapter['attempts_archived'] = current.execute('SELECT COUNT(*) FROM work_chapter_attempts WHERE chapter_id=?',(chapter['id'],)).fetchone()[0]
for work in works:
    rows = [c for c in chapters if c['work_id']==work['id']]
    prior = [c for c in old.values() if c['work_id']==work['id']]
    states = {s:sum(c['state']==s for c in rows) for s in sorted({c['state'] for c in rows})}
    work.update(total=len(rows),states=states,ready=states.get('ready',0),previous_ready=sum(c['state']=='ready' for c in prior),previous_errors=sum(c['state']=='error' for c in prior),previous_errors_now_ready=sum(c['error_now_ready'] for c in rows),ready_from_ptbr=sum(c['state']=='ready' and c['language']=='pt-br' for c in rows),ready_requiring_translation=sum(c['state']=='ready' and c['language']!='pt-br' for c in rows),max_number=max((float(c['number']) for c in rows if c['number'] and c['number'].replace('.','',1).isdigit()),default=None))
    work['ready_chapters']=[c['number'] for c in rows if c['state']=='ready']
    work['unready_chapters']=[c['number'] for c in rows if c['state']!='ready']
report = {
    'captured_at':datetime.datetime.now(ZoneInfo('America/Sao_Paulo')).isoformat(),
    'git_commit':'6b1d386',
    'baseline_database':str(pathlib.Path(args.baseline)),
    'baseline_sha256':hashlib.sha256(pathlib.Path(args.baseline).read_bytes()).hexdigest(),
    'read_only':True,'external_calls':0,
    'interpretation':{'ready':'Estado técnico da fila; não certifica qualidade editorial. PT-BR da fonte dispensa OCR/LLM.', 'source_total':'Total importado de uma fonte não é total publicado da obra.'},
    'totals':{'registered':len(chapters),'ready':sum(c['state']=='ready' for c in chapters),'previous_ready':sum(c['state']=='ready' for c in old.values()),'previous_errors':sum(c['state']=='error' for c in old.values()),'previous_errors_now_ready':sum(c['error_now_ready'] for c in chapters),'previous_ready_preserved':all(c['preserved_previously_ready'] for c in chapters),'ready_integrity_passed':all(c['ready_integrity'] for c in chapters)},
    'works':works,'chapters':chapters,
    'source_checks':[dict(r) for r in current.execute('SELECT work_id,kind,url,status,message FROM work_source_checks ORDER BY work_id,kind')],
    'ready_pages_on_previously_failed_chapters':sum(p['state']=='ready' for c in chapters if c['was_error'] for p in by_chapter.get(c['id'],[])),
    'translated_balloons_on_previously_failed_chapters':sum(c['translated_balloons'] for c in chapters if c['was_error']),
}
current.close(); baseline.close()
(output/'auditoria.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
fields=['work_id','id','volume','number','language','previous_state','state','page_count','pages_recorded','pages_ready','pages_review','translated_balloons','was_error','error_now_ready','attempts_archived','missing_original_files','ready_integrity','message']
with (output/'capitulos.csv').open('w',newline='',encoding='utf-8-sig') as f:
    writer=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');writer.writeheader();writer.writerows(chapters)
lines=['# Auditoria da biblioteca KOMA', '',f"Captura em {report['captured_at']}. Consulta somente leitura ao banco; comparação com backup anterior à correção 0.4.1.",'', '| Obra | Cadastrados | Prontos antes | Prontos agora | Erros antigos agora prontos | Prontos já em PT-BR |','|---|---:|---:|---:|---:|---:|']
for w in works:lines.append(f"| {w['title']} | {w['total']} | {w['previous_ready']} | {w['ready']} | {w['previous_errors_now_ready']} | {w['ready_from_ptbr']} |")
lines += ['',f"Total: {report['totals']['registered']} registros; {report['totals']['ready']} em estado técnico pronto. {report['totals']['previous_errors_now_ready']} de {report['totals']['previous_errors']} capítulos anteriormente em erro passaram a prontos.",'','Estar em fila, ter resposta HTTP 200 ou reconhecer texto em uma página não comprova conclusão do capítulo nem fidelidade editorial. Os capítulos já em PT-BR não exercitaram OCR/tradução.','', '## Capítulos que estavam em erro','', '| Obra | Volume | Capítulo | Antes | Agora | Páginas prontas | Páginas com revisão | Balões com tradução salva |','|---|---|---|---|---|---:|---:|---:|']
for c in chapters:
    if c['was_error']:lines.append(f"| {c['work_id']} | {c['volume'] or '—'} | {c['number']} | error | {c['state']} | {c['pages_ready']} | {c['pages_review']} | {c['translated_balloons']} |")
lines += ['', '## Arquivos para conferência','', '- capitulos.csv: todos os registros, estado anterior/atual, páginas e balões salvos.','- auditoria.json: dados estruturados e critérios de contagem.','- O total real das publicações deve ser confirmado separadamente nas fontes oficiais.']
(output/'RELATORIO.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({'captured_at':report['captured_at'],'totals':report['totals'],'works':[{'title':w['title'],'total':w['total'],'ready':w['ready'],'previous_ready':w['previous_ready'],'states':w['states']} for w in works],'report':str(output/'RELATORIO.md')},ensure_ascii=False,indent=2))
