import { type ReactNode } from "react";



import { Card, CardContent } from "@/shared/components/Card";

import { PageHeader } from "@/shared/components/PageHeader";



type EntityListPageProps = {

  actions?: ReactNode;

  children: ReactNode;

  description: string;

  title: string;

};



export function EntityListPage({

  actions,

  children,

  description,

  title,

}: EntityListPageProps) {

  return (

    <div className="space-y-5">

      <PageHeader actions={actions} description={description} title={title} />



      <Card>

        <CardContent className="min-w-0 space-y-4 p-4">{children}</CardContent>

      </Card>

    </div>

  );

}

