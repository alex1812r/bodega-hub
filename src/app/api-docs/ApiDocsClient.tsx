"use client";

import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";

export function ApiDocsClient() {
  return <SwaggerUI docExpansion="list" url="/openapi.yml" />;
}
