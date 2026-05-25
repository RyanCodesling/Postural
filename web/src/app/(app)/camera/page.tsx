import { Suspense } from "react";
import CameraClient from "./CameraClient";

export default function CameraPage() {
  return (
    <Suspense>
      <CameraClient />
    </Suspense>
  );
}
