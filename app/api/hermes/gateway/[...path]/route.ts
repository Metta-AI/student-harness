import {hermesGateway} from '../../../../../lib/hermes/gateway-meter';
export const maxDuration=800;
type Context={params:Promise<{path:string[]}>};
export async function GET(request:Request,{params}:Context){return hermesGateway(request,(await params).path);}
export async function POST(request:Request,{params}:Context){return hermesGateway(request,(await params).path);}
