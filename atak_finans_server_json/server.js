
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const app = express();
const DATA = path.join(__dirname,"data.json");
const upload = multer({dest:path.join(__dirname,"uploads")});

app.use(express.json({limit:"5mb"}));
app.use(express.urlencoded({extended:true}));
app.use(session({
  secret: process.env.SESSION_SECRET || "ATAK-FINANS-CHANGE-ME",
  resave:false, saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:"lax"}
}));
app.use(express.static(path.join(__dirname,"public")));

function freshDB(){
  return {
    users:[],
    transactions:[],
    invoices:[],
    bankMovements:[],
    cards:[],
    cardMovements:[],
    partnerMovements:[],
    reviewQueue:[],
    settings:{beko_debt:0,istikbal_debt:0,cash:0,tax_reserved:0},
    importLog:[]
  };
}
let db = fs.existsSync(DATA) ? JSON.parse(fs.readFileSync(DATA,"utf8")) : freshDB();

function save(){
  fs.writeFileSync(DATA, JSON.stringify(db,null,2), "utf8");
}
function seedUser(name,role,pw){
  if(!db.users.find(x=>x.name===name)){
    db.users.push({name,role,password_hash:bcrypt.hashSync(pw,10),active:true});
  }
}
seedUser("Taha","admin","1234");
seedUser("Hasan","partner","1234");
seedUser("Emir","beko_staff","1234");
seedUser("İbrahim","istikbal_staff","1234");
save();

const uid = (prefix)=> prefix+"_"+Date.now()+"_"+Math.random().toString(36).slice(2,9);
const norm=v=>String(v??"").toLocaleUpperCase("tr-TR").replace(/\s+/g," ").trim();
function trNum(v){
  if(typeof v==="number")return v;
  let s=String(v??"").trim().replace(/\s/g,"").replace(/₺|TL|TRY/gi,"");
  if(!s)return 0;
  if(s.includes(",")&&s.includes(".")){
    if(s.lastIndexOf(",")>s.lastIndexOf(".")) s=s.replace(/\./g,"").replace(",",".");
    else s=s.replace(/,/g,"");
  } else if(s.includes(",")) s=s.replace(",",".");
  return Number(s)||0;
}
function isoDate(v){
  const s=String(v??"").trim();
  if(/^\d{2}\/\d{2}\/\d{4}$/.test(s)){
    const [d,m,y]=s.split("/"); return `${y}-${m}-${d}`;
  }
  return s.slice(0,10);
}
function auth(req,res,next){if(!req.session.user)return res.status(401).json({error:"Oturum gerekli"});next();}
function admin(req,res,next){if(req.session.user?.role!=="admin")return res.status(403).json({error:"Yetki yok"});next();}
function roleCanSeeUnit(user,unit){
  if(["admin","partner"].includes(user.role))return true;
  if(user.role==="beko_staff")return unit==="Beko";
  if(user.role==="istikbal_staff")return unit==="İstikbal";
  return false;
}
function addReview(x){
  if(db.reviewQueue.some(r=>r.source_key===x.source_key))return;
  db.reviewQueue.unshift({id:uid("rev"),resolved:false,...x});
}
function logImport(source,filename,new_count,skipped_count,user){
  db.importLog.unshift({id:uid("imp"),source,filename,new_count,skipped_count,created_by:user,created_at:new Date().toISOString()});
}

app.post("/api/login",(req,res)=>{
  const u=db.users.find(x=>x.name===req.body.name&&x.active);
  if(!u||!bcrypt.compareSync(String(req.body.password||""),u.password_hash))return res.status(401).json({error:"Hatalı kullanıcı veya şifre"});
  req.session.user={name:u.name,role:u.role};res.json(req.session.user);
});
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me",(req,res)=>res.json(req.session.user||null));

app.get("/api/dashboard",auth,(req,res)=>{
  const ym=new Date().toISOString().slice(0,7);
  const visible=db.transactions.filter(x=>roleCanSeeUnit(req.session.user,x.unit));
  const month=visible.filter(x=>String(x.date).startsWith(ym));
  const income=month.filter(x=>x.type==="Gelir").reduce((s,x)=>s+x.amount,0);
  const expense=month.filter(x=>x.type==="Gider").reduce((s,x)=>s+x.amount,0);
  const cardDebt=db.cards.reduce((s,x)=>s+Number(x.debt||0),0);
  const s=db.settings;
  res.json({
    cash:s.cash,bekoDebt:s.beko_debt,istikbalDebt:s.istikbal_debt,cardDebt,tax:s.tax_reserved,
    monthIncome:income,monthExpense:expense,monthNet:income-expense,
    freeCash:s.cash-s.beko_debt-s.istikbal_debt-cardDebt-s.tax_reserved,
    review:db.reviewQueue.filter(x=>!x.resolved).length
  });
});

app.get("/api/transactions",auth,(req,res)=>{
  res.json(db.transactions.filter(x=>roleCanSeeUnit(req.session.user,x.unit)).slice(0,500));
});
app.post("/api/transactions",auth,(req,res)=>{
  let unit=req.body.unit;
  if(req.session.user.role==="beko_staff")unit="Beko";
  if(req.session.user.role==="istikbal_staff")unit="İstikbal";
  db.transactions.unshift({
    id:uid("tx"),date:req.body.date,type:req.body.type,unit,
    category:req.body.category,description:req.body.description,
    amount:Number(req.body.amount||0),payment_method:req.body.payment_method||"",
    source:"Manuel",created_by:req.session.user.name
  });
  save();res.json({ok:true});
});

app.get("/api/cards",auth,(req,res)=>res.json(["admin","partner"].includes(req.session.user.role)?db.cards:[]));
app.post("/api/cards",admin,(req,res)=>{
  db.cards.push({id:uid("card"),owner:req.body.owner,bank_name:req.body.bank_name,last4:req.body.last4||"",card_limit:Number(req.body.card_limit||0),debt:Number(req.body.debt||0),cut_day:req.body.cut_day||null,due_day:req.body.due_day||null});
  save();res.json({ok:true});
});

app.get("/api/review",admin,(req,res)=>res.json(db.reviewQueue.filter(x=>!x.resolved)));
app.post("/api/review/:id/resolve",admin,(req,res)=>{
  const r=db.reviewQueue.find(x=>x.id===req.params.id);
  if(!r)return res.status(404).json({error:"Kayıt yok"});
  db.transactions.unshift({id:uid("tx"),date:r.date,type:r.amount<0?"Gider":"Gelir",unit:req.body.target,category:r.suggested_category||"Diğer",description:r.description,amount:Math.abs(r.amount),payment_method:r.source,source:r.source,created_by:req.session.user.name});
  r.resolved=true;r.resolved_target=req.body.target;r.resolved_by=req.session.user.name;
  save();res.json({ok:true});
});

app.post("/api/settings",admin,(req,res)=>{
  for(const k of ["cash","tax_reserved","beko_debt","istikbal_debt"]) if(k in req.body) db.settings[k]=Number(req.body[k]||0);
  save();res.json({ok:true});
});
app.post("/api/users/:name/password",admin,(req,res)=>{
  const u=db.users.find(x=>x.name===req.params.name);if(!u)return res.status(404).json({error:"Kullanıcı yok"});
  u.password_hash=bcrypt.hashSync(String(req.body.password||""),10);save();res.json({ok:true});
});

app.post("/api/import/qnb",admin,upload.single("file"),(req,res)=>{
  try{
    const wb=XLSX.readFile(req.file.path), rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:""});
    let n=0,skip=0;
    for(const r of rows){
      const invoiceNo=r["Fatura No"]; if(!invoiceNo)continue;
      const uuid=String(r["Zarf No"]||invoiceNo), key="QNB:"+uuid;
      if(db.invoices.some(x=>x.source_key===key)){skip++;continue}
      const vkn=String(r["Gönderen VKN/TCKN"]||"").trim();
      const supplier=String(r["Gönderen Unvan/Ad Soyad"]||"").trim();
      const amount=trNum(r["Tutar"]), date=isoDate(r["Fatura Tarihi"]);
      let company="Diğer",status="Kontrol";
      if(vkn==="0730433545"||norm(supplier).includes("ARÇELİK PAZARLAMA")){company="Beko";status="Referans";}
      else if(vkn==="5230601780"||norm(supplier).includes("KARAVİL")){company="İstikbal";status="Cari Fatura";db.settings.istikbal_debt+=amount;}
      else if(vkn==="2650179910"||norm(supplier).includes("D-MARKET")){
        company="Beko";status="Beko Gideri";
        db.transactions.unshift({id:uid("tx"),date,type:"Gider",unit:"Beko",category:"Elektronik / Hepsiburada",description:`${supplier} ${invoiceNo}`,amount,payment_method:"Fatura",source:"QNB",created_by:"Sistem"});
      } else addReview({date,source:"QNB Gelen Fatura",description:`${supplier} ${invoiceNo}`,amount:-amount,suggested_category:"Gelen Fatura",source_key:"REV:"+key});
      db.invoices.unshift({id:uid("inv"),invoice_no:invoiceNo,uuid,date,supplier_vkn:vkn,supplier_name:supplier,amount,company,status,source_key:key});
      n++;
    }
    logImport("QNB Fatura",req.file.originalname,n,skip,req.session.user.name);save();res.json({new:n,skipped:skip});
  }finally{fs.unlink(req.file.path,()=>{});}
});

app.post("/api/import/garanti",admin,upload.single("file"),(req,res)=>{
  try{
    const wb=XLSX.readFile(req.file.path), rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:""});
    let n=0,skip=0;
    for(const r of rows){
      const date=isoDate(r["Tarih"]),desc=String(r["Açıklama"]||"").trim();if(!desc)continue;
      const amount=trNum(r["Tutar"]),receipt=String(r["Dekont No"]||"").trim();
      const key="GARANTI:"+(receipt||`${date}|${desc}|${amount}`);
      if(db.bankMovements.some(x=>x.source_key===key)){skip++;continue}
      let classification="Kontrol";const d=norm(desc),abs=Math.abs(amount);
      if(amount<0&&(d.includes("ARÇELİK PAZARLAMA")||d.includes("BEKO"))){classification="Beko Cari Ödeme";db.settings.beko_debt=Math.max(0,db.settings.beko_debt-abs);}
      else if(amount<0&&d.includes("KARAVİL")){classification="İstikbal Cari Ödeme";db.settings.istikbal_debt=Math.max(0,db.settings.istikbal_debt-abs);}
      else if(amount<0&&(d.includes("D-MARKET")||d.includes("HEPSİBURADA")||d.includes("MEDIAMARKT")||d.includes("TEKNOSA")||d.includes("VATAN"))){
        classification="Beko Gideri";db.transactions.unshift({id:uid("tx"),date,type:"Gider",unit:"Beko",category:"Elektronik",description:desc,amount:abs,payment_method:"Garanti Bankası",source:"Garanti",created_by:"Sistem"});
      }else if(amount<0)addReview({date,source:"Garanti Bankası",description:desc,amount,suggested_category:String(r["Etiket"]||""),source_key:"REV:"+key});
      db.bankMovements.unshift({id:uid("bank"),date,description:desc,amount,balance:trNum(r["Bakiye"]),receipt_no:receipt,bank_name:"Garanti",classification,source_key:key});n++;
    }
    logImport("Garanti Banka",req.file.originalname,n,skip,req.session.user.name);save();res.json({new:n,skipped:skip});
  }finally{fs.unlink(req.file.path,()=>{});}
});

app.post("/api/import/beko",admin,upload.single("file"),(req,res)=>{
  try{
    const wb=XLSX.readFile(req.file.path), matrix=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:""});
    let hi=-1;
    for(let i=0;i<Math.min(matrix.length,40);i++){const line=matrix[i].map(norm).join("|");const hits=["MAHSUP","AÇIKLAMA","BORÇ","ALACAK","KALAN","BAKİYE"].filter(x=>line.includes(x)).length;if(hits>=3){hi=i;break}}
    if(hi<0)return res.status(400).json({error:"Beko başlıkları bulunamadı"});
    const headers=matrix[hi].map(norm),find=(...keys)=>headers.findIndex(h=>keys.some(k=>h.includes(norm(k))));
    const cDesc=find("Açıklama","İşlem Açıklaması"),cDoc=find("Mahsup No","Belge No","Mahsup"),cDate=find("Tarih","Belge Tarihi"),cDebit=find("Borç"),cCredit=find("Alacak"),cRemain=find("Kalan","Bakiye");
    let n=0,skip=0,lastRemain=null;
    for(let i=hi+1;i<matrix.length;i++){
      const r=matrix[i],desc=String(r[cDesc]||"").trim(),doc=String(r[cDoc]||"").trim();if(!desc&&!doc)continue;
      const debit=cDebit>=0?trNum(r[cDebit]):0,credit=cCredit>=0?trNum(r[cCredit]):0,remain=cRemain>=0?trNum(r[cRemain]):0,date=cDate>=0?isoDate(r[cDate]):"";
      const key="BEKO:"+(doc||`${date}|${desc}|${debit}|${credit}`);if(db.bankMovements.some(x=>x.source_key===key)){skip++;continue}
      db.bankMovements.unshift({id:uid("beko"),date,description:desc,amount:debit-credit,balance:remain,receipt_no:doc,bank_name:"Beko Kanalı",classification:"Beko Hesap Akışı",source_key:key});
      if(remain!==0)lastRemain=remain;n++;
    }
    if(lastRemain!==null)db.settings.beko_debt=Math.abs(lastRemain);
    logImport("Beko Hesap Akışı",req.file.originalname,n,skip,req.session.user.name);save();res.json({new:n,skipped:skip,balance:lastRemain});
  }finally{fs.unlink(req.file.path,()=>{});}
});

app.post("/api/import/card/:cardId",admin,upload.single("file"),(req,res)=>{
  try{
    const card=db.cards.find(x=>x.id===req.params.cardId);if(!card)return res.status(404).json({error:"Kart bulunamadı"});
    const wb=XLSX.readFile(req.file.path),matrix=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:""});
    let hi=-1;for(let i=0;i<Math.min(matrix.length,30);i++){const l=matrix[i].map(norm);if(l.some(x=>x.includes("TARİH"))&&l.some(x=>x.includes("TUTAR"))){hi=i;break}} if(hi<0)hi=0;
    const h=matrix[hi].map(norm),find=(...keys)=>h.findIndex(x=>keys.some(k=>x.includes(norm(k))));
    let cDate=find("İşlem Tarihi","Tarih"),cDesc=find("Açıklama","İşyeri","İşlem Açıklaması"),cAmount=find("Tutar","İşlem Tutarı","TL Tutarı"),cRef=find("Referans","İşlem No","Provizyon","Belge No");
    if(cDate<0)cDate=0;if(cDesc<0)cDesc=1;if(cAmount<0)cAmount=2;
    let n=0,skip=0;
    for(let i=hi+1;i<matrix.length;i++){
      const r=matrix[i],desc=String(r[cDesc]||"").trim();if(!desc)continue;const amount=Math.abs(trNum(r[cAmount]));if(!amount)continue;
      const date=isoDate(r[cDate]),ref=cRef>=0?String(r[cRef]||"").trim():"",key=`CARD:${card.id}:${ref||date+"|"+desc+"|"+amount}`;
      if(db.cardMovements.some(x=>x.source_key===key)){skip++;continue}
      const d=norm(desc);let unit="Kontrol",category="Diğer";
      if(d.includes("HEPSİBURADA")||d.includes("D-MARKET")||d.includes("MEDIAMARKT")||d.includes("TEKNOSA")||d.includes("VATAN")){unit="Beko";category="Elektronik";}
      else if(d.includes("KARAVİL")||d.includes("İSTİKBAL")){unit="İstikbal";category="İşletme";}
      else if(d.includes("MİGROS")||d.includes("CARREFOUR")||d.includes("A101")||d.includes("BİM ")){unit="Aile";category="Market";}
      if(unit==="Kontrol")addReview({date,source:`Kredi Kartı - ${card.owner}/${card.bank_name}`,description:desc,amount:-amount,suggested_category:category,source_key:"REV:"+key});
      else{
        db.transactions.unshift({id:uid("tx"),date,type:"Gider",unit,category,description:desc,amount,payment_method:`Kredi Kartı - ${card.owner}/${card.bank_name}`,source:"Kredi Kartı",created_by:"Sistem"});
        if(["Beko","İstikbal","Ortak İşletme"].includes(unit))db.partnerMovements.unshift({id:uid("pm"),date,partner:card.owner,movement_type:"Kartından Şirket İçin Harcadı",amount,description:desc,created_by:"Sistem"});
      }
      db.cardMovements.unshift({id:uid("cm"),card_id:card.id,date,description:desc,amount,classification:unit,source_key:key});n++;
    }
    logImport(`Kredi Kartı ${card.owner}/${card.bank_name}`,req.file.originalname,n,skip,req.session.user.name);save();res.json({new:n,skipped:skip});
  }finally{fs.unlink(req.file.path,()=>{});}
});

app.listen(process.env.PORT||3000,()=>console.log("Atak Finans: http://localhost:3000"));
