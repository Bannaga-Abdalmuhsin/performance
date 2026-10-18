import json, struct, zipfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def records(data):
    pos = 0
    while pos < len(data):
        typ = data[pos]; pos += 1
        if typ & 128:
            typ = (typ & 127) | (data[pos] << 7); pos += 1
        size = 0
        for shift in range(0, 28, 7):
            b = data[pos]; pos += 1; size |= (b & 127) << shift
            if not b & 128: break
        yield typ, memoryview(data)[pos:pos+size]
        pos += size

def u32(b, off=0): return struct.unpack_from('<I', b, off)[0]
def wide(b, off=0):
    n = u32(b, off)
    return bytes(b[off+4:off+4+n*2]).decode('utf-16-le', errors='replace'), off+4+n*2

def rk(b, off=0):
    n = u32(b, off)
    v = struct.unpack('<i',struct.pack('<I', n))[0] >> 2 if n & 2 else struct.unpack('<d', b'\0\0\0\0'+struct.pack('<I', n & 0xfffffffc))[0]
    return v / 100 if n & 1 else v

def load_xlsb(path):
    z = zipfile.ZipFile(path)
    strings = [wide(b, 1)[0] for t,b in records(z.read('xl/sharedStrings.bin')) if t == 19]
    sheets = []
    for t,b in records(z.read('xl/workbook.bin')):
        if t == 156:
            rid, off = wide(b, 8)
            name, off = wide(b, off)
            sheets.append((name, f'xl/worksheets/sheet{rid[3:]}.bin'))
    print('SHEETS', sheets, 'SHARED STRINGS', len(strings))
    output = {}
    for name, file in sheets:
        rows = {}; row = 0; counts = Counter()
        for t,b in records(z.read(file)):
            counts[t] += 1
            if t == 0: row = u32(b); continue
            if t not in range(1,12) or len(b)<8: continue
            col = u32(b)
            if t == 1: continue
            if t == 2: value = rk(b,8)
            elif t in (3,11): value = '#ERR'+str(b[8])
            elif t in (4,10): value = bool(b[8])
            elif t in (5,9): value = struct.unpack_from('<d',b,8)[0]
            elif t in (6,8): value = wide(b,8)[0]
            elif t == 7: value = strings[u32(b,8)]
            rows.setdefault(row,{})[col] = value
        print('SHEET', name, 'ROWS',len(rows),'MAX_ROW',max(rows,default=0),'COLS',max((max(r,default=0) for r in rows.values()),default=0), 'TYPES',counts.most_common(10))
        print(json.dumps(list(rows.items())[:8],ensure_ascii=False)[:12000])
        output[name] = rows
    return output

if __name__ == '__main__':
    data=load_xlsb(ROOT/'upload/Accumulative Outages  Power report up to 28 July 2024.xlsb')
    (ROOT/'analysis/workbook-rows.json').write_text(json.dumps(data,ensure_ascii=False))
