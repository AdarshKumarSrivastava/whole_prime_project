import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/server/lib/prisma';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_PLATFORM_SECRET || 'fallback_secret';

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get('storefront_session')?.value;
    const siteId = req.nextUrl.searchParams.get('siteId');

    if (!token || !siteId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
    }

    if (!decoded.customerId || decoded.siteId !== siteId) {
      return NextResponse.json({ error: 'Unauthorized for this store' }, { status: 403 });
    }

    // Strictly query orders for this customer and this site
    const orders = await prisma.order.findMany({
      where: {
        siteId,
        customerId: decoded.customerId,
      },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                images: true,
                price: true,
              }
            }
          }
        },
        timeline: {
          orderBy: { createdAt: 'desc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json({ orders });
  } catch (error) {
    console.error('[Storefront Orders GET Error]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get('storefront_session')?.value;
    const body = await req.json();
    const { siteId, items, shippingAddress, billingAddress, discount = 0, shipping = 0 } = body;

    if (!siteId || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Missing siteId or cart items' }, { status: 400 });
    }

    let customerId: string | null = null;
    if (token) {
      try {
        const decoded: any = jwt.verify(token, JWT_SECRET);
        if (decoded.siteId === siteId && decoded.customerId) {
          customerId = decoded.customerId;
        }
      } catch {
        // Guest or expired session
      }
    }

    // Securely calculate total and map items
    const productIds = items.map((it: any) => it.productId || it.id).filter(Boolean);
    const dbProducts = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        siteId,
      }
    });

    const productMap = new Map(dbProducts.map(p => [p.id, p]));

    let calculatedSubtotal = 0;
    const orderItemsData: { productId: string; name: string; quantity: number; price: number; total: number }[] = [];

    for (const item of items) {
      const pid = item.productId || item.id;
      const dbProd = productMap.get(pid);
      const price = dbProd ? dbProd.price : Number(item.price) || 0;
      const name = dbProd ? dbProd.name : item.name || 'Product';
      const quantity = Math.max(1, parseInt(item.quantity) || 1);
      const total = price * quantity;

      calculatedSubtotal += total;
      orderItemsData.push({
        productId: pid,
        name,
        quantity,
        price,
        total,
      });
    }

    const calculatedTax = calculatedSubtotal * 0.05; // 5% standard tax estimate
    const calculatedTotal = Math.max(0, calculatedSubtotal + calculatedTax + Number(shipping) - Number(discount));
    const orderNumber = `ORD-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;

    const order = await prisma.$transaction(async (tx) => {
      // Create Order
      const newOrder = await tx.order.create({
        data: {
          siteId,
          customerId,
          orderNumber,
          status: 'CONFIRMED',
          subtotal: calculatedSubtotal,
          tax: calculatedTax,
          discount: Number(discount) || 0,
          shipping: Number(shipping) || 0,
          total: calculatedTotal,
          shippingAddress: shippingAddress || null,
          billingAddress: billingAddress || null,
          items: {
            create: orderItemsData.map(item => ({
              productId: item.productId,
              name: item.name,
              quantity: item.quantity,
              price: item.price,
              total: item.total,
            }))
          },
          timeline: {
            create: {
              status: 'CONFIRMED',
              message: 'Order placed successfully and confirmed.',
            }
          }
        },
        include: {
          items: true,
          timeline: true,
        }
      });

      // Update inventory where tracked
      for (const item of orderItemsData) {
        if (productMap.has(item.productId)) {
          await tx.product.update({
            where: { id: item.productId },
            data: {
              stock: { decrement: item.quantity }
            }
          }).catch(() => {});
        }
      }

      return newOrder;
    });

    return NextResponse.json({
      success: true,
      message: 'Order created successfully',
      order,
    }, { status: 201 });
  } catch (error) {
    console.error('[Storefront Orders POST Error]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
