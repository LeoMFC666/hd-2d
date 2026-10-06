import { MapCatalog } from '../src/gen3/world/MapCatalog';
import { MapWorld } from '../src/gen3/world/MapWorld';

const BASE=0x08000000;
const group3Names=[
'PalletTown','ViridianCity','PewterCity','CeruleanCity','LavenderTown','VermilionCity','CeladonCity','FuchsiaCity','CinnabarIsland','IndigoPlateau_Exterior','SaffronCity','SaffronCity_Connection','OneIsland','TwoIsland','ThreeIsland','FourIsland','FiveIsland','SevenIsland','SixIsland','Route1','Route2','Route3','Route4','Route5','Route6','Route7','Route8','Route9','Route10','Route11','Route12','Route13','Route14','Route15','Route16','Route17','Route18','Route19','Route20','Route21_North','Route21_South','Route22','Route23','Route24','Route25','OneIsland_KindleRoad','OneIsland_TreasureBeach','TwoIsland_CapeBrink','ThreeIsland_BondBridge','ThreeIsland_Port','Prototype_SeviiIsle_6','Prototype_SeviiIsle_7','Prototype_SeviiIsle_8','Prototype_SeviiIsle_9','FiveIsland_ResortGorgeous','FiveIsland_WaterLabyrinth','FiveIsland_Meadow','FiveIsland_MemorialPillar','SixIsland_OutcastIsland','SixIsland_GreenPath','SixIsland_WaterPath','SixIsland_RuinValley','SevenIsland_TrainerTower','SevenIsland_SevaultCanyon_Entrance','SevenIsland_SevaultCanyon','SevenIsland_TanobyRuins'
];

function u8(a:number):number{return a>=0&&a<rom.length?rom[a]:0}
function u32(a:number):number{return (u8(a)|u8(a+1)<<8|u8(a+2)<<16|u8(a+3)*0x1000000)>>>0}

let rom:Uint8Array;
async function main(){
 rom=new Uint8Array(await (await fetch('/Pokemon - FireRed Version (USA, Europe) (Rev 1).gba')).arrayBuffer());
 const gameCode=String.fromCharCode(rom[0xac],rom[0xad],rom[0xae],rom[0xaf]);
 if(gameCode!=='BPRE'||rom[0xbc]!==1) throw new Error('wrong ROM');

 // Find Cinnabar anchor independently by dimensions and its two exact connections.
 let anchorLayout=0, anchorId=0;
 for(let off=0;off+0x1c<=rom.length;off+=4){
   const h=BASE+off, la=u32(off);
   if(la<BASE||la>=BASE+rom.length) continue;
   const lo=la-BASE, w=u32(lo), ht=u32(lo+4);
   if(w!==24||ht!==20) continue;
   const cp=u32(off+0x0c);
   if(cp<BASE||cp>=BASE+rom.length) continue;
   const co=cp-BASE, n=u32(co)|0;
   if(n<2||n>64) continue;
   const da=u32(co+4)-BASE;
   if(da<0||da+n*0xc>rom.length) continue;
   let north=false,east=false;
   for(let i=0;i<n;i++){
     const e=da+i*0xc;
     const dir=u8(e), ofs=u32(e+4)|0, mg=u8(e+8), mn=u8(e+9);
     if(dir===2&&ofs===0&&mg===3&&mn===40) north=true;
     if(dir===4&&ofs===0&&mg===3&&mn===38) east=true;
   }
   if(north&&east){anchorLayout=la;anchorId=(u8(off+0x12)|u8(off+0x13)<<8);break}
 }
 if(!anchorLayout) throw new Error('Cinnabar anchor not found independently');

 const catalog=new MapCatalog();
 const count=catalog.buildGen3FromRom(rom,{mapGroup:3,mapNumber:8,mapLayoutId:anchorId,mapLayoutAddress:anchorLayout});
 if(count!==425) throw new Error('catalog count '+count);

 const world=new MapWorld(catalog);
 const connected=world.buildFrom(3,0);
 if(connected!==37) throw new Error('connected count '+connected);

 const positioned=world.getPositionedMaps();
 const rect=(m:any)=>{const p=world.getWorldPosition(m.mapGroup,m.mapNumber)!;return {key:m.mapGroup+':'+m.mapNumber,name:m.mapGroup===3?group3Names[m.mapNumber]??'',x:p.x,y:p.y,w:m.width,h:m.height}};
 const rects=positioned.map(rect);

 const overlaps=[];
 for(let i=0;i<rects.length;i++) for(let j=i+1;j<rects.length;j++){
   const a=rects[i],b=rects[j];
   const ox=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x);
   const oy=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);
   if(ox>0&&oy>0) overlaps.push({a:a.key,b:b.key,aName:a.name,bName:b.name,overlapX:ox,overlapY:oy});
 }

 const adjacencyErrors=[];
 for(const source of positioned){
   const sp=world.getWorldPosition(source.mapGroup,source.mapNumber)!;
   for(const c of source.connections){
     const target=catalog.get(c.mapGroup,c.mapNumber); if(!target) {adjacencyErrors.push({source:source.mapGroup+':'+source.mapNumber,target:c.mapGroup+':'+c.mapNumber,error:'target missing'});continue;}
     const tp=world.getWorldPosition(target.mapGroup,target.mapNumber); if(!tp){adjacencyErrors.push({source:source.mapGroup+':'+source.mapNumber,target:c.mapGroup+':'+c.mapNumber,error:'target unpositioned'});continue;}
     let ok=true;
     switch(c.direction){
      case 'NORTH': ok=tp.y+target.height===sp.y && tp.x===sp.x+c.offset; break;
      case 'SOUTH': ok=tp.y===sp.y+source.height && tp.x===sp.x+c.offset; break;
      case 'WEST': ok=tp.x+target.width===sp.x && tp.y===sp.y+c.offset; break;
      case 'EAST': ok=tp.x===sp.x+source.width && tp.y===sp.y+c.offset; break;
     }
     if(!ok) adjacencyErrors.push({source:source.mapGroup+':'+source.mapNumber,target:c.mapGroup+':'+c.mapNumber,direction:c.direction,offset:c.offset,sourcePos:sp,targetPos:tp});
   }
 }

 const cin=rect(catalog.get(3,8)!);
 const cinConnections=(catalog.get(3,8)!.connections).map(c=>({direction:c.direction,target:c.mapGroup+':'+c.mapNumber,name:c.mapGroup===3?group3Names[c.mapNumber]??'':'' ,offset:c.offset,pos:world.getWorldPosition(c.mapGroup,c.mapNumber)}));
 const result={pass:overlaps.length===0&&adjacencyErrors.length===0,catalogCount:count,connectedCount:connected,positionedCount:positioned.length,cinnabar:cin,cinConnections,overlapCount:overlaps.length,overlaps,adjacencyErrorCount:adjacencyErrors.length,adjacencyErrors};
 document.querySelector('#out')!.textContent=JSON.stringify(result,null,2);
 document.body.dataset.pass=result.pass?'true':'false';
}
main().catch(e=>{document.querySelector('#out')!.textContent=JSON.stringify({pass:false,error:String(e)},null,2);document.body.dataset.pass='false';throw e});