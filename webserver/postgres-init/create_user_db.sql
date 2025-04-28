CREATE TABLE
  public.users (
    id serial NOT NULL,
    username character varying(255) NOT NULL DEFAULT now(),
    created_at timestamp without time zone NULL,
    role character varying(255) NULL,
    password character varying(255) NULL
  );

ALTER TABLE
  public.users
ADD
  CONSTRAINT untitled_table_pkey PRIMARY KEY (id)