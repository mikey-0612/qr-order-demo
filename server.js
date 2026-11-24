// Bản thử nghiệm đặt món bằng QR. Chạy: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000; // máy chủ hosting sẽ tự cấp cổng
const TABLES = [1, 2]; // các bàn đang thử nghiệm

// >>> ĐỔI THÀNH TÀI KHOẢN NGÂN HÀNG CỦA QUÁN (mã ngân hàng theo VietQR: VCB, TCB, MB, ACB, BIDV, ...)
const BANK = { id: 'VCB', account: '0123456789', name: 'NGUYEN VAN A' };

// >>> SỬA MENU Ở ĐÂY (id không được trùng nhau)
const MENU = [
  { id: 1, name: 'Phở bò', price: 55000 },
  { id: 2, name: 'Bún chả', price: 50000 },
  { id: 3, name: 'Cơm tấm sườn', price: 48000 },
  { id: 4, name: 'Trà đá', price: 5000 },
  { id: 5, name: 'Cà phê sữa', price: 25000 },
];

const DATA_FILE = path.join(__dirname, 'data.json');
let db = { nextId: 1, orders: [] };
try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {}
const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));

const send = (res, code, body, type) => {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};
const html = (res, name) =>
  send(res, 200, fs.readFileSync(path.join(__dirname, 'public', name), 'utf8'), 'text/html; charset=utf-8');
const readBody = (req) => new Promise((resolve) => {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 1e5) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch (e) { resolve({}); } });
});
const total = (orders) =>
  orders.reduce((s, o) => s + o.items.reduce((a, i) => a + i.price * i.qty, 0), 0);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    const m = p.match(/^\/t\/(\d+)$/);
    if (m) {
      if (!TABLES.includes(Number(m[1]))) return send(res, 404, 'Không có bàn này', 'text/plain; charset=utf-8');
      return html(res, 'order.html');
    }
    if (p === '/kitchen') return html(res, 'kitchen.html');
    if (p === '/api/menu') return send(res, 200, { menu: MENU, bank: BANK });

    if (p === '/api/order' && req.method === 'POST') {
      const b = await readBody(req);
      const table = Number(b.table);
      const device = String(b.device || '').slice(0, 40);
      if (!TABLES.includes(table) || !device || !Array.isArray(b.items)) return send(res, 400, { error: 'Dữ liệu không hợp lệ' });
      const items = [];
      for (const it of b.items) {
        const food = MENU.find((f) => f.id === Number(it.id));
        const qty = Math.min(Math.max(parseInt(it.qty, 10) || 0, 0), 20);
        if (food && qty > 0) items.push({ name: food.name, price: food.price, qty }); // giá luôn lấy từ server
      }
      if (!items.length) return send(res, 400, { error: 'Chưa chọn món' });
      db.orders.push({ id: db.nextId++, table, device, items, status: 'new', paid: false, time: new Date().toISOString() });
      save();
      return send(res, 200, { ok: true });
    }

    if (p === '/api/bill') {
      const table = Number(url.searchParams.get('table'));
      const device = url.searchParams.get('device');
      const mine = db.orders.filter((o) => o.table === table && o.device === device);
      return send(res, 200, { orders: mine, total: total(mine.filter((o) => !o.paid)) });
    }

    if (p === '/api/kitchen') return send(res, 200, { orders: db.orders });

    if (p === '/api/done' && req.method === 'POST') {
      const b = await readBody(req);
      const o = db.orders.find((x) => x.id === Number(b.id));
      if (o) { o.status = 'done'; save(); }
      return send(res, 200, { ok: true });
    }
    if (p === '/api/paid' && req.method === 'POST') {
      const b = await readBody(req);
      db.orders.forEach((o) => { if (o.table === Number(b.table) && o.device === b.device) o.paid = true; });
      save();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/reset' && req.method === 'POST') {
      db = { nextId: 1, orders: [] }; save();
      return send(res, 200, { ok: true });
    }
    send(res, 404, 'Không tìm thấy', 'text/plain; charset=utf-8');
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Lỗi máy chủ' });
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log('\nĐã chạy! Mở trên máy tính: http://localhost:' + PORT + '/kitchen');
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach((k) => nets[k].forEach((n) => {
    if (n.family === 'IPv4' && !n.internal) {
      console.log('Địa chỉ cho điện thoại (cùng Wi-Fi):');
      TABLES.forEach((t) => console.log('  Bàn ' + t + ': http://' + n.address + ':' + PORT + '/t/' + t));
      console.log('  Màn hình bếp/thu ngân: http://' + n.address + ':' + PORT + '/kitchen');
    }
  }));
});
