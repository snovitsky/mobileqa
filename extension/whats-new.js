const target = document.getElementById('releases');
try {
 const response = await fetch(chrome.runtime.getURL('release-notes.json'));
 if (!response.ok) throw new Error('Local notes unavailable');
 const { releases } = await response.json();
 if (!Array.isArray(releases)) throw new Error('Invalid notes');
 target.replaceChildren();
 for (const release of releases) {
  const section = document.createElement('section');
  section.id = 'v' + release.version;
  const heading = document.createElement('h2');
  heading.textContent = `${release.version} — ${release.title}`;
  const date = document.createElement('p');
  date.textContent = release.date;
  const list = document.createElement('ul');
  for (const change of release.changes) {
   const item = document.createElement('li');item.textContent = change;list.append(item);
  }
  section.append(heading, date, list);target.append(section);
 }
 const selected = target.querySelector('[id="' + CSS.escape(location.hash.slice(1)) + '"]');
 selected?.scrollIntoView();
} catch { target.textContent = 'Не удалось открыть историю изменений. Закройте эту вкладку и попробуйте снова.'; }
