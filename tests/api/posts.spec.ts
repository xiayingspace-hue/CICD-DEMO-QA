import { test, expect } from '@playwright/test';

test.describe('posts API', () => {
  test('GET /posts/1 returns a post', async ({ request }) => {
    const res = await request.get('/posts/1');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: 1, userId: expect.any(Number), title: expect.any(String) });
  });

  test('POST /posts creates a post', async ({ request }) => {
    const payload = { title: 'hello', body: 'world', userId: 1 };
    const res = await request.post('/posts', { data: payload });
    expect(res.status()).toBe(201);
    expect(await res.json()).toMatchObject(payload);
  });

  test('GET unknown post returns 404', async ({ request }) => {
    const res = await request.get('/posts/999999');
    expect(res.status()).toBe(404);
  });
});
