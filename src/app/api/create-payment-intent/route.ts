
import { NextResponse, type NextRequest } from 'next/server';

// This endpoint is disabled as payment is no longer required.
export async function POST(request: NextRequest) {
  return NextResponse.json({ message: 'Not Found' }, { status: 404 });
}
