(function(){
  var FALLBACK={
    settings:{
      siteName:'Atak Home',
      tagline:'Eviniz için her şey',
      phone:'02122232871',
      whatsapp:'905433585060',
      email:'tarabyabeko@gmail.com',
      address:'Ferahevler Mah. Adnan Kahveci Cad. No:109 Sarıyer / İstanbul'
    },
    banners:[{
      headline:'Evinizi sadece döşemeyin. Yaşatın.',
      subheadline:'Beko ürünleri, mobilya, klima, TV ve ev yaşam çözümleri Atak Home’da.'
    }],
    campaigns:[
      {title:'Çeyiz Paketleri',subtitle:'Evinize güçlü bir başlangıç',label:'FIRSAT'},
      {title:'Klima Fırsatları',subtitle:'Serinlik evinize yakışsın',label:'FIRSAT'},
      {title:'TV Kampanyaları',subtitle:'Sinemayı eve taşıyın',label:'FIRSAT'}
    ],
    categories:[
      {name:'Beyaz Eşya'},{name:'Klima'},{name:'TV & Elektronik'},
      {name:'Küçük Ev Aletleri'},{name:'Mobilya'},{name:'Grundig Kişisel Bakım'},
      {name:'Çamaşır Makinesi'},{name:'Bulaşık Makinesi'},{name:'Buzdolabı'},
      {name:'Pişiriciler'},{name:'Dondurucu'},{name:'Kurutma Makinesi'}
    ],
    products:[]
  };

  var menuBtn=document.getElementById('menuBtn');
  var nav=document.getElementById('nav');
  if(menuBtn&&nav){
    menuBtn.addEventListener('click',function(){nav.classList.toggle('open');});
    nav.querySelectorAll('a').forEach(function(a){
      a.addEventListener('click',function(){nav.classList.remove('open');});
    });
  }

  function esc(s){
    return String(s==null?'':s).replace(/[&<>"]/g,function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]);
    });
  }

  function render(data){
    var banner=(data.banners&&data.banners[0])||FALLBACK.banners[0];
    var title=document.getElementById('heroTitle');
    var text=document.getElementById('heroText');
    if(title&&banner.headline)title.textContent=banner.headline;
    if(text&&banner.subheadline)text.textContent=banner.subheadline;

    var cats=document.getElementById('cats');
    var list=(data.categories&&data.categories.length?data.categories:FALLBACK.categories);
    cats.innerHTML=list.map(function(c){
      return '<article class="card"><h3>'+esc(c.name)+'</h3><p>Showroom’da görün</p></article>';
    }).join('');

    var cams=document.getElementById('cams');
    var camps=(data.campaigns&&data.campaigns.length?data.campaigns:FALLBACK.campaigns);
    cams.innerHTML=camps.map(function(c){
      return '<article class="card"><span class="tag">'+esc(c.label||'KAMPANYA')+'</span><h3>'+esc(c.title)+'</h3><p>'+esc(c.subtitle||'')+'</p></article>';
    }).join('');

    var prods=document.getElementById('prods');
    var items=data.products||[];
    var note=document.getElementById('prodNote');
    if(!items.length){
      if(note)note.textContent='Şu an vitrinde listelenen ürün yok. Mağazadan veya WhatsApp’tan sorun.';
      prods.innerHTML='<div class="empty">Ürünler showroom’da. Fiyat ve stok için 0212 223 28 71 veya WhatsApp.</div>';
      return;
    }
    if(note)note.textContent=items.length+' ürün listeleniyor.';
    prods.innerHTML=items.map(function(p){
      var price=p.salePrice!=null?p.salePrice:p.price;
      var priceTxt=price!=null?Number(price).toLocaleString('tr-TR')+' TL':'Fiyat için sorun';
      return '<article class="card"><h3>'+esc(p.name||'Ürün')+'</h3><p>'+esc(p.brand||'')+' · '+esc(priceTxt)+'</p></article>';
    }).join('');
  }

  render(FALLBACK);
  fetch('/web-api/public',{headers:{'Accept':'application/json'}})
    .then(function(r){if(!r.ok)throw new Error('api');return r.json();})
    .then(render)
    .catch(function(){render(FALLBACK);});
})();
