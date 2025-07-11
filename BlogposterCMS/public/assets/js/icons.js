window.featherIcons = {
  home:        '/assets/icons/home.svg',               
  setHome:     '/assets/icons/home.svg', 
  edit:        '/assets/icons/edit-2.svg',             
  draft:       '/assets/icons/file-text.svg',              
  published:   '/assets/icons/check-circle.svg',       
  delete:      '/assets/icons/trash-2.svg',
  editSlug:    '/assets/icons/edit-3.svg',
  pencil:      '/assets/icons/pencil-gradient.svg',
  share:       '/assets/icons/share.svg',
  bold:        '/assets/icons/bold.svg',
  italic:      '/assets/icons/italic.svg',
  underline:   '/assets/icons/underline.svg',
  'external-link': '/assets/icons/external-link.svg'
};

window.featherIcon = function(name, extraClass = '') {
  const src = window.featherIcons[name] || `/assets/icons/${name}.svg`;
  return `<img class="icon ${extraClass}" src="${src}" alt="${name}" />`;
};
