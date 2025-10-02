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
  CONSTRAINT untitled_table_pkey PRIMARY KEY (id);


CREATE EXTENSION IF NOT EXISTS pgcrypto;


ALTER TABLE public.users
  ALTER COLUMN created_at SET DEFAULT now();


ALTER TABLE public.users
  ALTER COLUMN username DROP DEFAULT;


ALTER TABLE public.users ADD CONSTRAINT users_username_key UNIQUE (username);




CREATE OR REPLACE FUNCTION public.users_hash_password() RETURNS trigger AS $$
BEGIN
  IF NEW.password IS NOT NULL THEN
    
    IF NEW.password !~ '^\\$' THEN
      NEW.password := crypt(NEW.password, gen_salt('bf'));
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


DROP TRIGGER IF EXISTS trg_users_hash_password ON public.users;
CREATE TRIGGER trg_users_hash_password
BEFORE INSERT OR UPDATE OF password ON public.users
FOR EACH ROW EXECUTE FUNCTION public.users_hash_password();