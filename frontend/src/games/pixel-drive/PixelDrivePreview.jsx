// Development-only local game. Production sessions use the authenticated API.
import PixelDrive from "@/pages/PixelDrive";
import {createLocalDriveService} from "./localProgress";
const service=createLocalDriveService();
export default function PixelDrivePreview(){return <PixelDrive service={service} preview/>;}
