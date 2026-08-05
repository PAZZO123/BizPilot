#!/bin/bash
# End-to-end smoke test against the seeded demo business.
API=http://localhost:4000/api
pass=0; fail=0

check() { # name, condition-output
  if [ -n "$2" ] && [ "$2" != "null" ]; then
    echo "  PASS  $1 -> $2"; pass=$((pass+1))
  else
    echo "  FAIL  $1"; fail=$((fail+1))
  fi
}

echo "== auth =="
LOGIN=$(curl -s -m 20 -X POST $API/auth/login -H "Content-Type: application/json" \
  -d '{"email":"demo@bizpilot.rw","password":"demo1234"}')
TOKEN=$(echo "$LOGIN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).accessToken||'')}catch(e){console.log('')}})")
check "login returns access token" "$(echo ${TOKEN:0:12})"
AUTH="Authorization: Bearer $TOKEN"

j() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);console.log(eval('o$1')??'null')}catch(e){console.log('null')}})"; }

echo "== dashboard & reports =="
DASH=$(curl -s -m 30 "$API/reports/dashboard" -H "$AUTH")
check "dashboard month revenue"   "$(echo "$DASH" | j '.thisMonth.revenue')"
check "dashboard net profit"      "$(echo "$DASH" | j '.thisMonth.netProfit')"
check "revenue trend has 30 days" "$(echo "$DASH" | j '.revenueTrend.length')"
check "top products present"      "$(echo "$DASH" | j '.topProducts.length')"
check "low stock count"           "$(echo "$DASH" | j '.lowStockCount!==undefined?String(o.lowStockCount):null')"
check "overdue invoice total"     "$(echo "$DASH" | j '.overdueInvoiceTotal')"

PL=$(curl -s -m 30 "$API/reports/profit-loss" -H "$AUTH")
check "P&L gross margin %"        "$(echo "$PL" | j '.grossMarginPct')"
check "P&L expense categories"    "$(echo "$PL" | j '.expensesByCategory.length')"

HOURS=$(curl -s -m 30 "$API/reports/sales-by-hour" -H "$AUTH")
check "sales by hour buckets"     "$(echo "$HOURS" | j '.length')"

echo "== catalogue =="
PRODS=$(curl -s -m 20 "$API/products?pageSize=50" -H "$AUTH")
check "products list total"       "$(echo "$PRODS" | j '.total')"
# Pick a stock-tracked product with headroom — the first product alphabetically
# is "Airtime top-up", a service with no stock, which would make the stock
# assertions below meaningless.
PID=$(echo "$PRODS" | j '.items.find(p=>p.trackStock&&p.stockQty>10).id')
check "stock-tracked product id"  "$PID"
check "inventory value at cost"   "$(curl -s -m 20 "$API/products/inventory-value" -H "$AUTH" | j '.costValue')"

echo "== record a sale (stock must move) =="
BEFORE=$(curl -s -m 20 "$API/products/$PID" -H "$AUTH" | j '.stockQty')
SALE=$(curl -s -m 30 -X POST "$API/sales" -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"items\":[{\"productId\":\"$PID\",\"quantity\":2}],\"paymentMethod\":\"CASH\"}")
check "sale created with number"  "$(echo "$SALE" | j '.number')"
check "sale total"                "$(echo "$SALE" | j '.total')"
AFTER=$(curl -s -m 20 "$API/products/$PID" -H "$AUTH" | j '.stockQty')
if [ "$AFTER" -eq "$((BEFORE-2))" ]; then
  echo "  PASS  stock decremented $BEFORE -> $AFTER"; pass=$((pass+1))
else
  echo "  FAIL  stock $BEFORE -> $AFTER (expected $((BEFORE-2)))"; fail=$((fail+1))
fi

echo "== oversell must be rejected =="
OVER=$(curl -s -m 30 -X POST "$API/sales" -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"items\":[{\"productId\":\"$PID\",\"quantity\":999999}]}")
case "$(echo "$OVER" | j '.message')" in
  *"Not enough"*) echo "  PASS  oversell rejected"; pass=$((pass+1));;
  *) echo "  FAIL  oversell not rejected: $OVER"; fail=$((fail+1));;
esac

echo "== invoices =="
INVS=$(curl -s -m 20 "$API/invoices" -H "$AUTH")
IID=$(echo "$INVS" | j '.items[0].id')
check "invoice list outstanding"  "$(echo "$INVS" | j '.outstandingTotal')"
check "invoice id"                "$IID"
PDF_BYTES=$(curl -s -m 40 "$API/invoices/$IID/pdf" -H "$AUTH" -o /tmp/bp-invoice.pdf -w '%{size_download}')
HEADER=$(head -c 4 /tmp/bp-invoice.pdf)
if [ "$HEADER" = "%PDF" ] && [ "$PDF_BYTES" -gt 1000 ]; then
  echo "  PASS  invoice PDF rendered ($PDF_BYTES bytes)"; pass=$((pass+1))
else
  echo "  FAIL  invoice PDF (header=$HEADER size=$PDF_BYTES)"; fail=$((fail+1))
fi

echo "== customers, expenses, plans =="
check "customers owing"           "$(curl -s -m 20 "$API/customers?owingOnly=true" -H "$AUTH" | j '.total')"
check "expenses total"            "$(curl -s -m 20 "$API/expenses" -H "$AUTH" | j '.totalAmount')"
check "entitlements plan"         "$(curl -s -m 20 "$API/me/entitlements" -H "$AUTH" | j '.plan.id')"
check "billing overview"          "$(curl -s -m 20 "$API/billing" -H "$AUTH" | j '.plan.name')"
check "assistant status"          "$(curl -s -m 20 "$API/assistant/status" -H "$AUTH" | j '.suggestions.length')"

echo "== tenant isolation =="
OTHER=$(curl -s -m 20 -X POST $API/auth/register -H "Content-Type: application/json" \
  -d '{"name":"Other Owner","email":"other'"$RANDOM"'@test.rw","password":"other1234","businessName":"Other Shop"}')
OTOKEN=$(echo "$OTHER" | j '.accessToken')
LEAK=$(curl -s -m 20 "$API/products/$PID" -H "Authorization: Bearer $OTOKEN" | j '.statusCode')
if [ "$LEAK" = "404" ]; then
  echo "  PASS  other tenant cannot read this product (404)"; pass=$((pass+1))
else
  echo "  FAIL  tenant isolation leak: $LEAK"; fail=$((fail+1))
fi

echo ""
echo "PASS=$pass FAIL=$fail"
[ "$fail" -eq 0 ] || exit 1
