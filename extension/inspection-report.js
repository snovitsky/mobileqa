const categories={overflow:'Выход за границы экрана',target:'Маленькие области нажатия',text:'Мелкий текст'};
const related=item=>Number.isSafeInteger(item.relatedCount)&&item.relatedCount>0?`Вложенные элементы с тем же переполнением: ${item.relatedCount}. Объединены в один пункт.`:'';
const element=(tag,text,className)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(className)el.className=className;return el;};
function repeatedFindings(findings){
 const groups=new Map();
 for(const item of findings){if(!groups.has(item.message))groups.set(item.message,[]);groups.get(item.message).push(item);}
 return groups;
}

export function renderInspectionReport(card,data,showFinding){
 const box=card.article.querySelector('.findings'),list=box.querySelector('div');
 const findings=(Array.isArray(data.findings)?data.findings:[]).slice(0,200).filter(item=>item&&categories[item.kind]&&typeof item.message==='string');
 const viewport=data.viewport||{},scannedAt=new Date().toLocaleString('ru-RU');
 const model=card.select.selectedOptions[0]?.textContent||card.select.value;
 const context=`${model} · ${viewport.width||'?'} × ${viewport.height||'?'} CSS px · ${scannedAt}`;
 box.hidden=false;box.open=true;list.replaceChildren();
 box.querySelector('summary').textContent=`Проверка вёрстки: ${findings.length} замечаний${data.truncated?' (часть результатов)':''}`;
 list.className='findings-content';
 list.append(element('p',context,'findings-context'));
 const feedback=element('p','','findings-feedback');feedback.setAttribute('role','status');
 card.inspection={id:data.inspectionId,url:data.url,feedback};
 const download=element('button','Скачать отчёт');download.type='button';
 download.addEventListener('click',()=>{
  const lines=['# Проверка вёрстки',`Адрес: ${data.url}`,`Экран: ${context}`,''];
  for(const [kind,title] of Object.entries(categories)){
   const group=findings.filter(item=>item.kind===kind);if(!group.length)continue;
   lines.push(`## ${title} — ${group.length}`,'');
   for(const [message,items] of repeatedFindings(group)){
    lines.push(`${message} — элементов: ${items.length}`,'');
    items.forEach((item,index)=>lines.push(`${index+1}. ${item.label||'Элемент'}`,`   CSS: ${item.selector||'не указан'}`,...(related(item)?['   '+related(item)]:[]),''));
   }
  }
  if(!findings.length)lines.push('По заданным правилам замечаний не найдено.');
  if(data.truncated)lines.push('Показана часть результатов: лимит 200 замечаний или 10 000 элементов.');
  const url=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');
  a.href=url;a.download='brandmaker-qa-layout-report.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
 list.append(download,feedback);
 for(const [kind,title] of Object.entries(categories)){
  const group=findings.filter(item=>item.kind===kind);if(!group.length)continue;
  const section=element('details',null,'findings-group');section.append(element('summary',`${title} — ${group.length}`));
  group.forEach((item,index)=>{
   const row=element('section',null,'finding-row'),show=element('button',`${index+1}. ${item.label||'Показать элемент'}`,'finding-show');show.type='button';show.title='Показать и подсветить элемент на этом экране';
   show.addEventListener('click',()=>{
    feedback.textContent='';
    if(!card.ready){feedback.textContent='Экран не подключён. Откройте сайт и повторите проверку.';return;}
   if(!Number.isSafeInteger(data.inspectionId)||typeof item.id!=='string'){feedback.textContent='Для подсветки обновите страницу в этом макете и повторите проверку.';return;}
    showFinding({inspectionId:data.inspectionId,url:data.url,findingId:item.id});
    card.frame.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
   });
   const technical=element('details',null,'finding-technical');technical.append(element('summary','Для разработчика'),element('code',item.selector||'Селектор не указан'));
   row.append(show,element('p',item.message));if(related(item))row.append(element('p',related(item),'findings-note'));row.append(technical);section.append(row);
  });
  list.append(section);
 }
 if(!findings.length)list.append(element('p','По заданным правилам замечаний не найдено.'));
 if(data.truncated)list.append(element('p','Показана часть результатов: лимит 200 замечаний или 10 000 элементов.','findings-note'));
}
