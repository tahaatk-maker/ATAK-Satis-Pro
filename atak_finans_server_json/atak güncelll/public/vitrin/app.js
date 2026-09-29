(function(){
  var MAIN_CATS=[
    {id:'beyaz-esya',name:'Beyaz Eşya',ico:'🧊'},
    {id:'klima',name:'Klima',ico:'❄️'},
    {id:'tv-elektronik',name:'TV',ico:'📺'},
    {id:'mobilya',name:'Mobilya',ico:'🛋️'},
    {id:'ceyiz',name:'Çeyiz',ico:'🎁'},
    {id:'kucuk-ev-aletleri',name:'Küçük Ev Aletleri',ico:'🔌'}
  ];
  var BRAND_FILTERS=[
    {id:'',name:'Tümü'},
    {id:'Beko',name:'Beko'},
    {id:'İstikbal',name:'İstikbal'}
  ];
  var CAM_IMG={
    'çeyiz':'/img/cam-ceyiz.jpg','ceyiz':'/img/cam-ceyiz.jpg',
    'klima':'/img/cam-klima.jpg','tv':'/img/cam-tv.jpg'
  };
  var SHOWCASE=[
    {id:'demo-buz',name:'No-frost buzdolabı',brand:'Beko',category:'buzdolabi',image:'/img/urun-buzdolabi.jpg',wa:'Buzdolabı',salePrice:39999,listPrice:42999},
    {id:'demo-klima',name:'Duvar tipi klima',brand:'Beko',category:'klima',image:'/img/urun-klima.jpg',wa:'Klima',salePrice:26999,listPrice:28999},
    {id:'demo-tv',name:'4K televizyon',brand:'Beko',category:'tv-elektronik',image:'/img/urun-tv.jpg',wa:'Televizyon',salePrice:18999,listPrice:20999},
    {id:'demo-koltuk',name:'L köşe koltuk',brand:'İstikbal',category:'oturma-grubu',image:'/img/urun-kanepe.jpg',wa:'Koltuk',salePrice:49999,listPrice:54999}
  ];
  var FALLBACK={
    settings:{siteName:'Atak Home',tagline:'Eviniz için her şey',phone:'02122232871',whatsapp:'905433585060',address:'Ferahevler Mah. Adnan Kahveci Cad. No:109 Sarıyer / İstanbul'},
    banners:[{headline:'Evinizi sadece döşemeyin. Yaşatın.',subheadline:'Beko beyaz eşya ve İstikbal mobilya — Atak Home Sarıyer showroom.',ctaText:'Ürünleri keşfet',ctaUrl:'#/urunler',desktopImage:'/img/hero.jpg'}],
    campaigns:[
      {title:'Çeyiz Paketleri',subtitle:'Evinize güçlü bir başlangıç',label:'FIRSAT',homepage:true},
      {title:'Klima Fırsatları',subtitle:'Serinlik evinize yakışsın',label:'FIRSAT',homepage:true},
      {title:'TV Kampanyaları',subtitle:'Sinemayı eve taşıyın',label:'FIRSAT',homepage:true}
    ],
    categories:MAIN_CATS,brands:[{id:'beko',name:'Beko'},{id:'istikbal',name:'İstikbal'}],products:[]
  };
  var data=FALLBACK, slide=0, cart=[];

  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function money(n){return Number(n||0).toLocaleString('tr-TR')+' TL';}
  function wa(){return String((data.settings||{}).whatsapp||'905433585060').replace(/\D/g,'');}
  function phone(){return String((data.settings||{}).phone||'02122232871');}
  function img(u){if(!u)return '';if(/^https?:|data:|\//.test(u))return u;return '/'+u;}
  function price(p){return Number(p.salePrice!=null?p.salePrice:(p.cashPrice!=null?p.cashPrice:p.listPrice||0));}
  function listPrice(p){return Number(p.listPrice||p.oldPrice||0);}
  function navCats(){
    var api=(data.categories||[]).filter(function(c){return !c.parent;});
    if(api.length>=4){
      return api.slice(0,8).map(function(c){
        var hit=MAIN_CATS.find(function(m){return m.id===c.id;});
        return {id:c.id,name:c.name,ico:hit?hit.ico:'•'};
      });
    }
    return MAIN_CATS;
  }
  function childCats(parentId){
    return (data.categories||[]).filter(function(c){return String(c.parent||'')===String(parentId);});
  }
  function brandMatch(p,brand){
    if(!brand)return true;
    return String(p.brand||'').toLocaleLowerCase('tr-TR')===String(brand).toLocaleLowerCase('tr-TR');
  }
  function camImg(c){
    var t=String(c.title||'').toLocaleLowerCase('tr-TR');
    if(/klima/.test(t))return '/img/cam-klima.jpg';
    if(/tv|televizyon/.test(t))return '/img/cam-tv.jpg';
    if(/çeyiz|ceyiz/.test(t))return '/img/cam-ceyiz.jpg';
    return CAM_IMG.ceyiz;
  }
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
    if(i>=0)cart[i].qty+=1;else cart.push({id:p.id,name:p.name,price:price(p)||0,qty:1});
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
    }).join(''):'<p>Sepet boş.</p>';
    var lines=cart.map(function(x){return '- '+x.name+' x'+x.qty;}).join('%0A');
    document.getElementById('cartWa').href='https://wa.me/'+wa()+'?text='+encodeURIComponent('Merhaba, Atak Home sipariş:\n')+lines;
  }

  function waLink(text){return 'https://wa.me/'+wa()+'?text='+encodeURIComponent('Merhaba, '+text+' hakkında bilgi almak istiyorum.');}

  function productCard(p){
    var pr=price(p);
    var old=listPrice(p)>pr?'<span class="old">'+esc(money(listPrice(p)))+'</span>':'';
    var pic=img(p.image||(p.images&&p.images[0])||'');
    var priceHtml=pr?esc(money(pr))+old:'Fiyat için sorun';
    var href=String(p.id).indexOf('demo-')===0?'#/urunler':'#/urun/'+esc(p.id);
    return '<article class="pcard"><a href="'+href+'"><div class="pic">'+(pic?'<img src="'+esc(pic)+'" alt="">':'')+'</div></a><div class="body"><div class="brand">'+esc(p.brand||'')+'</div><h3>'+esc(p.name||'Ürün')+'</h3><div class="price">'+priceHtml+'</div><div class="card-actions"><button type="button" class="btn btn-ghost wide" data-add="'+esc(p.id)+'">Sepete ekle</button><a class="btn btn-primary wide" href="'+waLink(p.wa||p.name)+'" target="_blank" rel="noopener">WhatsApp ile sor</a></div></div></article>';
  }

  function home(){
    var banners=data.banners&&data.banners.length?data.banners:FALLBACK.banners;
    var b=banners[slide%banners.length];
    var bg=img(b.desktopImage||b.mobileImage||'')||'/img/hero.jpg';
    if(!b.desktopImage&&!b.mobileImage)bg='/img/hero.jpg';
    var camps=(data.campaigns||[]).filter(function(c){return c.homepage!==false;}).slice(0,3);
    if(!camps.length)camps=FALLBACK.campaigns;
    var prods=(data.products||[]).slice().sort(function(a,c){return (c.featured?1:0)-(a.featured?1:0);}).slice(0,8);
    if(!prods.length)prods=SHOWCASE;
    var beko=(data.products||[]).filter(function(p){return /beko/i.test(p.brand||'');}).slice(0,4);
    var ist=(data.products||[]).filter(function(p){return /istikbal/i.test(p.brand||'');}).slice(0,4);
    var html='<section class="hero" style="background-image:url(\''+esc(bg)+'\')"><button class="arrow l" type="button" id="prevSlide">‹</button><button class="arrow r" type="button" id="nextSlide">›</button><div class="hero-inner"><p class="brand-hero">Atak Home</p><h1>'+esc(b.headline||'Atak Home')+'</h1><p>'+esc(b.subheadline||'')+'</p><div class="hero-cta"><a class="btn btn-primary" href="#/urunler">'+esc(b.ctaText||'Ürünleri keşfet')+'</a><a class="btn btn-ghost-light" href="#/urunler?brand=Beko">Beko</a><a class="btn btn-ghost-light" href="#/urunler?brand=%C4%B0stikbal">İstikbal</a></div><div class="dots">'+banners.map(function(_,i){return '<i class="'+(i===slide%banners.length?'on':'')+'"></i>';}).join('')+'</div></div></section>';
    html+='<section class="section wrap"><div class="cams">'+camps.map(function(c){
      return '<a class="cam" href="#/urunler" style="background-image:url(\''+esc(camImg(c))+'\')"><div class="txt"><h3>'+esc(c.title)+'</h3><p>'+esc(c.subtitle||'')+'</p><span>Keşfet →</span></div></a>';
    }).join('')+'</div></section>';
    html+='<section class="section wrap"><div class="section-head"><h2>Öne çıkanlar</h2><a href="#/urunler">Tümünü gör</a></div><div class="prods">'+prods.map(productCard).join('')+'</div></section>';
    if(beko.length){
      html+='<section class="section wrap"><div class="section-head"><h2>Beko beyaz eşya</h2><a href="#/urunler?brand=Beko">Tümü</a></div><div class="prods">'+beko.map(productCard).join('')+'</div></section>';
    }
    if(ist.length){
      html+='<section class="section wrap"><div class="section-head"><h2>İstikbal mobilya</h2><a href="#/urunler?brand=%C4%B0stikbal">Tümü</a></div><div class="prods">'+ist.map(productCard).join('')+'</div></section>';
    }
    return html;
  }

  function listing(){
    var r=route();
    var q=String(r.params.q||'').toLocaleLowerCase('tr-TR');
    var cat=String(r.params.cat||'');
    var brand=String(r.params.brand||'');
    var items=(data.products||[]).filter(function(p){
      if(cat){
        var same=String(p.category)===cat;
        var child=childCats(cat).some(function(c){return String(p.category)===c.id;});
        if(!same && !child) return false;
      }
      if(!brandMatch(p,brand)) return false;
      if(q){
        var blob=(p.name+' '+p.brand+' '+(p.code||'')).toLocaleLowerCase('tr-TR');
        if(blob.indexOf(q)<0)return false;
      }
      return true;
    });
    if(!items.length && !(data.products||[]).length) items=SHOWCASE.filter(function(p){
      return (!cat||p.category===cat||childCats(cat).some(function(c){return c.id===p.category;})) && brandMatch(p,brand);
    });
    var catsForFilter=navCats().concat(childCats('beyaz-esya')).concat(childCats('mobilya'));
    var seen={};
    catsForFilter=catsForFilter.filter(function(c){if(seen[c.id])return false;seen[c.id]=1;return true;});
    var html='<div class="wrap"><div class="crumb"><a href="#/">Anasayfa</a> / Ürünler</div><div class="list-wrap"><aside class="filters"><h3>Filtre</h3><label>Marka<select id="fBrand">'+BRAND_FILTERS.map(function(b){
      return '<option value="'+esc(b.id)+'"'+(brand===b.id?' selected':'')+'>'+esc(b.name)+'</option>';
    }).join('')+'</select></label><label>Kategori<select id="fCat"><option value="">Tümü</option>'+catsForFilter.map(function(c){
      return '<option value="'+esc(c.id)+'"'+(cat===c.id?' selected':'')+'>'+esc(c.name)+'</option>';
    }).join('')+'</select></label></aside><div><div class="section-head"><h2>'+(q?('Arama: '+esc(q)):(brand||'Ürünler'))+'</h2><p>'+items.length+' ürün</p></div>';
    html+=items.length?'<div class="prods">'+items.map(productCard).join('')+'</div>':'<div class="empty">Bu filtrede ürün yok. WhatsApp’tan sorun.</div>';
    html+='</div></div></div>';
    return html;
  }

  function detail(id){
    var p=(data.products||[]).find(function(x){return String(x.id)===String(id);});
    if(!p)return '<div class="wrap empty" style="margin:40px auto">Ürün bulunamadı. <a href="#/urunler">Listeye dön</a></div>';
    var pic=img(p.image||(p.images&&p.images[0])||'');
    var pr=price(p);
    return '<div class="wrap"><div class="crumb"><a href="#/">Anasayfa</a> / <a href="#/urunler">Ürünler</a> / '+esc(p.name)+'</div><div class="detail"><div>'+(pic?'<img src="'+esc(pic)+'" alt="">':'')+'</div><div><div class="brand">'+esc(p.brand||'')+'</div><h1>'+esc(p.name)+'</h1><div class="price">'+(pr?esc(money(pr)):'Fiyat için sorun')+'</div><button type="button" class="btn btn-ghost" data-add="'+esc(p.id)+'">Sepete ekle</button> <a class="btn btn-primary" href="'+waLink(p.name)+'" target="_blank" rel="noopener">WhatsApp ile sor</a><p>'+esc(p.description||'Showroom’da yerinde inceleyebilirsiniz.')+'</p></div></div></div>';
  }

  function catsBar(){
    document.getElementById('catsBar').innerHTML=navCats().map(function(c){
      return '<a class="cat-btn" href="#/urunler?cat='+encodeURIComponent(c.id)+'"><span>'+c.ico+'</span>'+esc(c.name)+'</a>';
    }).join('');
  }

  function bindCards(){
    document.querySelectorAll('[data-add]').forEach(function(btn){
      btn.onclick=function(){
        var id=btn.getAttribute('data-add');
        var p=(data.products||[]).concat(SHOWCASE).find(function(x){return String(x.id)===String(id);});
        if(p) addCart(p);
      };
    });
  }

  function render(){
    var r=route();
    var box=document.getElementById('app');
    if(r.path.indexOf('/urun/')===0) box.innerHTML=detail(r.path.slice(6));
    else if(r.path.indexOf('/urunler')===0) box.innerHTML=listing();
    else box.innerHTML=home();
    catsBar();
    drawCart();
    bindCards();
    var raw=phone().replace(/\D/g,'');
    document.getElementById('phoneBtn').href='tel:+90'+raw.replace(/^90/,'').replace(/^0/,'');
    document.getElementById('waBtn').href='https://wa.me/'+wa();
    if(data.settings&&data.settings.address)document.getElementById('footAddr').textContent=data.settings.address;
    var prev=document.getElementById('prevSlide');
    var next=document.getElementById('nextSlide');
    if(prev)prev.onclick=function(){slide=Math.max(0,slide-1);render();};
    if(next)next.onclick=function(){slide++;render();};
    var fCat=document.getElementById('fCat');
    var fBrand=document.getElementById('fBrand');
    if(fCat||fBrand){
      var applyFilters=function(){
        var parts=[];
        if(fCat&&fCat.value) parts.push('cat='+encodeURIComponent(fCat.value));
        if(fBrand&&fBrand.value) parts.push('brand='+encodeURIComponent(fBrand.value));
        go('/urunler'+(parts.length?'?'+parts.join('&'):''));
      };
      if(fCat)fCat.onchange=applyFilters;
      if(fBrand)fBrand.onchange=applyFilters;
    }
  }

  document.getElementById('searchForm').onsubmit=function(e){
    e.preventDefault();
    go('/urunler?q='+encodeURIComponent(document.getElementById('searchInput').value.trim()));
  };
  document.getElementById('cartBtn').onclick=function(){document.getElementById('cartDrawer').classList.remove('hidden');};
  document.getElementById('cartClose').onclick=document.getElementById('cartX').onclick=function(){document.getElementById('cartDrawer').classList.add('hidden');};
  window.addEventListener('hashchange',render);

  function apply(d){
    data=d||FALLBACK;
    if(!data.settings)data.settings=FALLBACK.settings;
    if(!data.products)data.products=[];
    if(!data.campaigns||!data.campaigns.length)data.campaigns=FALLBACK.campaigns;
    if(!data.banners||!data.banners.length)data.banners=FALLBACK.banners;
    if(!data.categories||!data.categories.length)data.categories=FALLBACK.categories;
    render();
  }
  apply(FALLBACK);
  fetch('/web-api/public',{headers:{'Accept':'application/json'}})
    .then(function(r){if(!r.ok)throw new Error('api');return r.json();})
    .then(apply)
    .catch(function(){apply(FALLBACK);});
})();
