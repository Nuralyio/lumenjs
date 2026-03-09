export function GET() {
  return Response.json({
    stats: [
      { label: 'Users', value: 1234 },
      { label: 'Revenue', value: 12345 },
      { label: 'Orders', value: 567 },
      { label: 'Conversion', value: 3.2 },
    ],
  });
}
