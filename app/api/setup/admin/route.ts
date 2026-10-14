import { z } from 'zod';
import { assertSetupAllowed } from '@/lib/setup-state';
import { json, fail } from '@/lib/server';
import { isSameOriginWrite } from '@/lib/write-origin';
import { MetaError } from '@/lib/meta-core';

export const dynamic = 'force-dynamic';

const adminSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es requerido.').max(100),
  email: z.string().trim().email('Email inválido.').toLowerCase(),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.').max(128),
});

export async function POST(request: Request) {
  try {
    if (!isSameOriginWrite(request)) {
      throw new MetaError('Solicitud de otro origen bloqueada.', 403);
    }

    await assertSetupAllowed();

    const body = await request.json().catch(() => {
      throw new MetaError('Cuerpo de solicitud inválido.', 400);
    });

    const validated = adminSchema.parse(body);

    const { auth } = await import('@/lib/auth');
    const created = await auth.api.createUser({
      body: {
        email: validated.email,
        password: validated.password,
        name: validated.name,
        role: 'admin',
      },
    });

    return json({
      ok: true,
      user: {
        id: created.user.id,
        email: created.user.email,
        name: created.user.name,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json({ error: error.issues[0]?.message || 'Datos inválidos.' }, 400);
    }
    return fail(error);
  }
}
