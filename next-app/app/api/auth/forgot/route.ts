export async function POST() {
  return Response.json(
    {
      error:
        "Сброс пароля по email отключён. Обратитесь к администратору в MAX: https://max.ru/u/f9LHodD0cOKSJihr4puAfiyfPGQJWImlRAdNuRhpYwI7qse5YaB625-1d3w",
    },
    { status: 410 },
  );
}
