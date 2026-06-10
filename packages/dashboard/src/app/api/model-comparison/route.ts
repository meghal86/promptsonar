import { NextResponse } from 'next/server';
import { compareModels } from '@promptsonar/core';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = compareModels({
      prompt: body.prompt,
      expectedFormat: body.expectedFormat,
      outputs: body.outputs,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Model comparison failed.' }, { status: 400 });
  }
}
