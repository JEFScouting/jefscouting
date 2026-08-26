document.getElementById('year').textContent=new Date().getFullYear();
const io=new IntersectionObserver(es=>es.forEach(e=>e.isIntersecting&&e.target.classList.add('revealed')),{threshold:.12});
document.querySelectorAll('.cards article,.process>div,.about>div').forEach(el=>{el.classList.add('reveal');io.observe(el)});