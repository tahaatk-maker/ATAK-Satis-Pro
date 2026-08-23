(function(){
  var FALLBACK={
    settings:{siteName:'Atak Home',tagline:'Eviniz için her şey',phone:'02122232871',whatsapp:'905433585060',email:'tarabyabeko@gmail.com',address:'Ferahevler Mah. Adnan Kahveci Cad. No:109 Sarıyer / İstanbul'},
    banners:[{headline:'Evinizi sadece döşemeyin. Yaşatın.',subheadline:'Beko ürünleri, mobilya, klima, TV ve ev yaşam çözümleri Atak Home’da.',ctaText:'Ürünleri keşfet',ctaUrl:'#/urunler'}],
    campaigns:[
      {title:'Çeyiz Paketleri',subtitle:'Evinize güçlü bir başlangıç',label:'FIRSAT',homepage:true},
      {title:'Klima Fırsatları',subtitle:'Serinlik evinize yakışsın',label:'FIRSAT',homepage:true},
      {title:'TV Kampanyaları',subtitle:'Sinemayı eve taşıyın',label:'FIRSAT',homepage:true}
    ],
    categories:[
      {id:'beyaz-esya',name:'Beyaz Eşya'},{id:'klima',name:'Klima'},{id:'tv-elektronik',name:'TV & Elektronik'},
      {id:'kucuk-ev-aletleri',name:'Küçük Ev Aletleri'},{id:'mobilya',name:'Mobilya'},{id:'camasir-makinesi',name:'Çamaşır Makinesi'}
    ],
    products:[]
  };
  var data=FALLBACK, slide=0, cart=[];

  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function money(n){return Number(n||0).toLocaleString('tr-TR')+' TL';}
  function wa(){return String((data.settings||{}).whatsapp||'905433585060').replace(/\D/g,'');}
  function phone(){return String((data.settings||{}).phone||'02122232871');}
  function img(u){if(!u)return '';if(/^https?:|data:|\//.test(u))return u;return '/'+u;}
  function price(p){return Number(p.salePrice!=null?p.salePrice:(p.cashPrice!=null?p.cashPrice:p.listPrice||0));}
  function listPrice(p){return Number(p.listPrice||p.oldPrice||0);}
  function route(){
    var h=(location.hash||'#/').replace(/^#/,'');
    var q=h.split('?')[1]||'';
    var path=h.split('?')[0]||'/';
    var params={};
    q.split('&').forEach(function(part){
      if(!part)return;
      var kv=part.split('=');
      params[decodeURIComponent(kv[0]||'')]=decodeURIComponent((kv[1]||'').replace(/\+/g,' '));
    });
    return {path:path,params:params};
  }
  function go(path){location.hash=path;}

  try{cart=JSON.parse(localStorage.getItem('atakShopCart')||'[]');}catch(e){cart=[];}
  function saveCart(){localStorage.setItem('atakShopCart',JSON.stringify(cart));drawCart();}
  function addCart(p){
    var i=cart.findIndex(function(x){return x.id===p.id;});
    if(i>=0)cart[i].qty+=1;else cart.push({id:p.id,name:p.name,price:price(p),qty:1});
    saveCart();
    document.getElementById('cartDrawer').classList.remove('hidden');
  }
  function drawCart(){
    var n=cart.reduce(function(a,x){return a+x.qty;},0);
    var tot=cart.reduce(function(a,x){return a+x.price*x.qty;},0);
    document.getElementById('cartCount').textContent=n;
    document.getElementById('cartTotal').textContent=money(tot);
    document.getElementById('cartItems').innerHTML=cart.length?cart.map(function(x){
      return '<div class="cline"><div><b>'+esc(x.name)+'</b><div class="tiny">'+x.qty+' adet</div></div><div>'+esc(money(x.price*x.qty))+'</div></div>';
    }).join(''):'<p class="tiny">Sepet boş.</p>';
    var lines=cart.map(function(x){return '- '+x.name+' x'+x.qty+' ('+money(x.price*x.qty)+')';}).join('%0A');
    document.getElementById('cartWa').href='https://wa.me/'+wa()+'?text='+encodeURIComponent('Merhaba, Atak Home sipariş:\n')+lines+'%0AToplam: '+encodeURIComponent(money(tot));
  }

  function productCard(p){
    var old=listPrice(p)>price(p)?'<span class="old">'+esc(money(listPrice(p)))+'</span>':'';
    var pic=img(p.image||(p.images&&p.images[0])||'');
    return '<article class="pcard"><a href="#/urun/'+esc(p.id)+'"><div class="pic">'+(pic?'<img src="'+esc(pic)+'" alt="">':'<span class="tiny">Görsel yok</span>')+'</div></a><div class="body"><div class="brand">'+esc(p.brand||'')+'</div><h3><a href="#/urun/'+esc(p.id)+'">'+esc(p.name||'Ürün')+'</a></h3><div class="price">'+esc(money(price(p)))+old+'</div><div class="row"><button class="btn btn-primary" data-add="'+esc(p.id)+'">Sepete</button><a class="btn btn-line" href="https://wa.me/'+wa()+'?text='+encodeURIComponent('Merhaba, '+ (p.name||'ürün') +' hakkında bilgi almak istiyorum.')+'" target="_blank" rel="noopener">Sor</a></div></div></article>';
  }

  function catsBar(){
    var cats=data.categories||[];
    document.getElementById('catsBar').innerHTML='<a class="pill" href="#/urunler">Tümü</a>'+cats.slice(0,10).map(function(c){
      return '<a class="pill" href="#/urunler?cat='+encodeURIComponent(c.id||c.name)+'">'+esc(c.name)+'</a>';
    }).join('');
  }

  function home(){
    var banners=data.banners&&data.banners.length?data.banners:FALLBACK.banners;
    var b=banners[slide%banners.length];
    var bg=img(b.desktopImage||b.mobileImage||'');
    var camps=(data.campaigns||[]).filter(function(c){return c.homepage!==false;}).slice(0,3);
    if(!camps.length)camps=FALLBACK.campaigns;
    var prods=(data.products||[]).slice().sort(function(a,c){return (c.featured?1:0)-(a.featured?1:0);}).slice(0,8);
    var html='<section class="hero'+(bg?' has-img':'')+'"'+(bg?' style="background-image:linear-gradient(90deg,rgba(6,54,108,.78),rgba(10,77,148,.45)),url(\''+esc(bg)+'\')"':'')+'><div class="hero-inner"><p class="tiny">Sarıyer · Showroom</p><h1>'+esc(b.headline||'Atak Home')+'</h1><p>'+esc(b.subheadline||'')+'</p><div class="hero-cta"><a class="btn btn-primary" href="'+(b.ctaUrl&&b.ctaUrl.indexOf('#')===0?b.ctaUrl:'#/urunler')+'">'+esc(b.ctaText||'Ürünleri keşfet')+'</a><a class="btn btn-line" href="https://wa.me/'+wa()+'" target="_blank" rel="noopener">Danışmanla yaz</a></div><div class="dots">'+banners.map(function(_,i){return '<i class="'+(i===slide%banners.length?'on':'')+'"></i>';}).join('')+'</div></div></section>';
    html+='<section class="section wrap"><div class="section-head"><div><h2>Kampanyalar</h2><p>Panelden eklenen fırsatlar.</p></div></div><div class="grid cams">'+camps.map(function(c){
      return '<article class="card"><span class="tag">'+esc(c.label||'KAMPANYA')+'</span><h3>'+esc(c.title)+'</h3><p class="muted">'+esc(c.subtitle||'')+'</p></article>';
    }).join('')+'</div></section>';
    html+='<section class="section wrap"><div class="section-head"><div><h2>Kategoriler</h2></div><a href="#/urunler">Tümünü gör</a></div><div class="grid cats">'+(data.categories||[]).slice(0,12).map(function(c){
      return '<a class="card" href="#/urunler?cat='+encodeURIComponent(c.id||c.name)+'"><h3>'+esc(c.name)+'</h3><p class="muted">Showroom’da görün</p></a>';
    }).join('')+'</div></section>';
    html+='<section class="section wrap" id="products"><div class="section-head"><div><h2>Ürün vitrini</h2><p>Aktif ürünler panelden gelir.</p></div><a href="#/urunler">Tüm ürünler</a></div>';
    html+=prods.length?'<div class="grid prods">'+prods.map(productCard).join('')+'</div>':'<div class="empty">Şu an vitrinde ürün yok. Panel → Web Ürünleri veya Siteye Ürün Ekle.</div>';
    html+='</section>';
    return html;
  }

  function listing(){
    var r=route();
    var q=String(r.params.q||'').toLocaleLowerCase('tr-TR');
    var cat=String(r.params.cat||'');
    var brand=String(r.params.brand||'');
    var items=(data.products||[]).filter(function(p){
      if(cat && String(p.category)!==cat && String(p.categoryName||'')!==cat) return false;
      if(brand && String(p.brand||'').toLocaleLowerCase('tr-TR')!==brand.toLocaleLowerCase('tr-TR')) return false;
      if(q){
        var blob=(p.name+' '+p.brand+' '+(p.code||'')).toLocaleLowerCase('tr-TR');
        if(blob.indexOf(q)<0)return false;
      }
      return true;
    });
    var brands=[];
    (data.products||[]).forEach(function(p){if(p.brand&&brands.indexOf(p.brand)<0)brands.push(p.brand);});
    var html='<div class="wrap"><div class="crumb"><a href="#/">Anasayfa</a> / Ürünler</div><div class="list-wrap"><aside class="filters"><h3>Filtre</h3><label>Kategori<select id="fCat"><option value="">Tümü</option>'+(data.categories||[]).map(function(c){
      return '<option value="'+esc(c.id||c.name)+'"'+(cat===(c.id||c.name)?' selected':'')+'>'+esc(c.name)+'</option>';
    }).join('')+'</select></label><label>Marka<select id="fBrand"><option value="">Tümü</option>'+brands.map(function(b){
      return '<option'+(brand===b?' selected':'')+'>'+esc(b)+'</option>';
    }).join('')+'</select></label></aside><div><div class="section-head"><h2>'+(q?('Arama: '+esc(q)):'Ürünler')+'</h2><p>'+items.length+' ürün</p></div>';
    html+=items.length?'<div class="grid prods">'+items.map(productCard).join('')+'</div>':'<div class="empty">Bu filtrede ürün yok. WhatsApp’tan sorun.</div>';
    html+='</div></div></div>';
    return html;
  }

  function detail(id){
    var p=(data.products||[]).find(function(x){return String(x.id)===String(id);});
    if(!p)return '<div class="wrap empty" style="margin:40px auto">Ürün bulunamadı. <a href="#/urunler">Listeye dön</a></div>';
    var pic=img(p.image||(p.images&&p.images[0])||'');
    var old=listPrice(p)>price(p)?'<span class="old">'+esc(money(listPrice(p)))+'</span>':'';
    return '<div class="wrap"><div class="crumb"><a href="#/">Anasayfa</a> / <a href="#/urunler">Ürünler</a> / '+esc(p.name)+'</div><div class="detail"><div>'+(pic?'<img src="'+esc(pic)+'" alt="">':'<div class="empty">Görsel yok</div>')+'</div><div><div class="brand">'+esc(p.brand||'')+'</div><h1>'+esc(p.name)+'</h1><div class="price">'+esc(money(price(p)))+old+'</div><p class="muted">12 taksit ve teslimat için sorun.</p><div class="hero-cta"><button class="btn btn-primary" data-add="'+esc(p.id)+'">Sepete</button><a class="btn btn-line" href="https://wa.me/'+wa()+'?text='+encodeURIComponent('Merhaba, '+p.name+' hakkında bilgi almak istiyorum.')+'" target="_blank" rel="noopener">WhatsApp</a></div><p>'+esc(p.description||'Showroom’da yerinde inceleyebilirsiniz.')+'</p></div></div></div>';
  }

  function render(){
    var r=route();
    var box=document.getElementById('app');
    if(r.path.indexOf('/urun/')===0) box.innerHTML=detail(r.path.slice(6));
    else if(r.path.indexOf('/urunler')===0) box.innerHTML=listing();
    else box.innerHTML=home();
    catsBar();
    drawCart();
    var phonePretty=phone().replace(/^0/,'0');
    if(phonePretty.length===10)phonePretty=phonePretty.replace(/(\d{3})(\d{3})(\d{2})(\d{2})/,'0$1 $2 $3 $4');
    if(phonePretty.length===11)phonePretty=phonePretty.replace(/(\d{4})(\d{3})(\d{2})(\d{2})/,'$1 $2 $3 $4');
    document.getElementById('phoneBtn').href='tel:+90'+phone().replace(/\D/g,'').replace(/^90/,'').replace(/^0/,'');
    document.getElementById('phoneBtn').textContent=phonePretty||phone();
    document.getElementById('waBtn').href='https://wa.me/'+wa();
    if(data.settings&&data.settings.address)document.getElementById('footAddr').textContent=data.settings.address;
    var fCat=document.getElementById('fCat');
    var fBrand=document.getElementById('fBrand');
    if(fCat)fCat.onchange=function(){go('/urunler?cat='+encodeURIComponent(fCat.value)+(fBrand&&fBrand.value?'&brand='+encodeURIComponent(fBrand.value):''));};
    if(fBrand)fBrand.onchange=function(){go('/urunler?'+(fCat&&fCat.value?'cat='+encodeURIComponent(fCat.value)+'&':'')+'brand='+encodeURIComponent(fBrand.value));};
  }

  document.getElementById('searchForm').onsubmit=function(e){
    e.preventDefault();
    go('/urunler?q='+encodeURIComponent(document.getElementById('searchInput').value.trim()));
  };
  document.getElementById('cartBtn').onclick=function(){document.getElementById('cartDrawer').classList.remove('hidden');};
  document.getElementById('cartClose').onclick=document.getElementById('cartX').onclick=function(){document.getElementById('cartDrawer').classList.add('hidden');};
  document.getElementById('app').addEventListener('click',function(e){
    var btn=e.target.closest('[data-add]');
    if(!btn)return;
    var p=(data.products||[]).find(function(x){return String(x.id)===String(btn.getAttribute('data-add'));});
    if(p)addCart(p);
  });
  window.addEventListener('hashchange',render);

  function apply(d){
    data=d||FALLBACK;
    if(!data.settings)data.settings=FALLBACK.settings;
    if(!data.categories)data.categories=[];
    if(!data.products)data.products=[];
    if(!data.campaigns)data.campaigns=[];
    if(!data.banners||!data.banners.length)data.banners=FALLBACK.banners;
    render();
  }
  apply(FALLBACK);
  fetch('/web-api/public',{headers:{'Accept':'application/json'}})
    .then(function(r){if(!r.ok)throw new Error('api');return r.json();})
    .then(apply)
    .catch(function(){apply(FALLBACK);});
})();
