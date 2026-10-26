const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "0.0.0.0";

export const config = {
  port: Number(process.env.PORT ?? DEFAULT_PORT),
  host: process.env.HOST ?? DEFAULT_HOST,
};
