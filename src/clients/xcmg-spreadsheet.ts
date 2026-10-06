import * as XLSX from 'xlsx';

export type XcmgSpreadsheetSheet={
  name:string;
  rows:string[][];
  rowCount:number;
  columnCount:number;
};

export type XcmgSpreadsheetSnapshot={
  filename:string;
  sheetNames:string[];
  sheets:XcmgSpreadsheetSheet[];
  totalRows:number;
  totalCells:number;
};

const cellToText=(value:unknown)=>{
  if(value===null||value===undefined)return'';
  if(value instanceof Date)return value.toISOString();
  return String(value).trim();
};

export async function readXcmgSpreadsheet(file:File):Promise<XcmgSpreadsheetSnapshot>{
  const bytes=await file.arrayBuffer();
  const workbook=XLSX.read(bytes,{type:'array',cellDates:true,cellFormula:true,raw:false});
  const sheets:XcmgSpreadsheetSheet[]=workbook.SheetNames.map(name=>{
    const sheet=workbook.Sheets[name];
    const matrix=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:'',raw:false,blankrows:false});
    const rows=matrix.map(row=>row.map(cellToText));
    const columnCount=rows.reduce((max,row)=>Math.max(max,row.length),0);
    return{name,rows,rowCount:rows.length,columnCount};
  });
  return{
    filename:file.name,
    sheetNames:workbook.SheetNames,
    sheets,
    totalRows:sheets.reduce((sum,sheet)=>sum+sheet.rowCount,0),
    totalCells:sheets.reduce((sum,sheet)=>sum+sheet.rows.reduce((rowSum,row)=>rowSum+row.filter(Boolean).length,0),0)
  };
}

export function flattenXcmgSpreadsheet(snapshot:XcmgSpreadsheetSnapshot){
  return snapshot.sheets.flatMap(sheet=>sheet.rows.map((row,index)=>({sheet:sheet.name,row:index+1,values:row})));
}
