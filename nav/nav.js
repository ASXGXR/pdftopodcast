// Fetch and include the nav.html into any HTML file that references this script
document.addEventListener('DOMContentLoaded', () => {
    const navPlaceholder = document.createElement('div');
    navPlaceholder.id = 'nav-placeholder';
    document.body.insertBefore(navPlaceholder, document.body.firstChild);
  
    fetch('nav/nav.html')
      .then(response => response.text())
      .then(data => {
        navPlaceholder.innerHTML = data;
      })
      .catch(error => console.error('Error loading navigation:', error));
  });
  