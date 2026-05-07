from django.conf import settings


def environment(request):
    return {"IS_LOCAL": settings.DEBUG}
