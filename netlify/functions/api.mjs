import {getStore} from "@netlify/blobs";
import {handle} from "./core.mjs";
export const config={path:"/api/*"};
export default async (req)=>handle(req,getStore({name:"dhammika-site",consistency:"strong"}),{ADMIN_PASSWORD:Netlify.env.get("ADMIN_PASSWORD")});
